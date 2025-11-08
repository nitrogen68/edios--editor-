// server.js (Dioptimalkan untuk Vercel dengan Octokit dan Logging)

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors'); // <-- TAMBAHAN: Untuk mengatasi CORS
const { Octokit } = require("octokit"); // <-- TAMBAHAN: Untuk GitHub API

const app = express();
const DOCUMENT_ROOT = path.resolve(__dirname); 

// --- KONFIGURASI GITHUB API ---
// Hapus 'https://api.github.com' karena Octokit menanganinya secara otomatis
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN // Menggunakan token dari Vercel Environment Variables
});
// ------------------------------

// --- Middleware untuk CORS dan Error Token ---
app.use(cors()); // <-- TAMBAHAN: Mengizinkan akses lintas origin

// Middleware untuk pengecekan Token GitHub
app.use((req, res, next) => {
    if (req.url.startsWith('/api/') && (!process.env.GITHUB_TOKEN || !OWNER || !REPO)) {
        console.error("[CRITICAL ERROR] GITHUB_TOKEN, GITHUB_OWNER, atau GITHUB_REPO hilang dari Environment Variables.");
        return res.status(500).json({ 
            success: false, 
            message: "Konfigurasi GitHub API di server hilang. Cek Environment Variables Vercel." 
        });
    }
    next();
});

// --- Middleware untuk Logging Detail Permintaan ---
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logStatus = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'CLIENT_ERROR' : 'SUCCESS';
        console.log(`[ACCESS LOG] ${req.method} ${req.url} | Status: ${res.statusCode} (${logStatus}) | Time: ${duration}ms`);
    });
    next();
});

// Middleware untuk parsing body JSON dan URL-encoded
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// PENTING: Middleware untuk melayani aset statis
app.use(express.static(DOCUMENT_ROOT));


// Konfigurasi Multer (tetap menggunakan /tmp untuk Vercel)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, '/tmp/'); 
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });


// --- FUNGSI UTILITAS LOKAL (TIDAK RELEVAN UNTUK GITHUB API) ---
// Perhatian: Fungsi ini hanya relevan jika Anda ingin membaca file deployment, tetapi TIDAK untuk menulis/mengedit.
function getSafePath(userPath) {
    const targetPath = userPath.startsWith('/') ? userPath.substring(1) : userPath;
    let fullPath = path.join(DOCUMENT_ROOT, targetPath);
    if (!fullPath.startsWith(DOCUMENT_ROOT)) {
        return DOCUMENT_ROOT; 
    }
    return fullPath; 
}
function getRelativePath(absolutePath) {
    return '/' + path.relative(DOCUMENT_ROOT, absolutePath).replace(/\\/g, '/');
}


// --- ROUTES EXPRESS ---

// 1. Route Fallback untuk root / 
app.get('/', (req, res) => {
    res.sendFile(path.join(DOCUMENT_ROOT, 'index.html'));
});


// 2. API: Mendapatkan Daftar File (HARUS DIGANTI DENGAN OCTOKIT)
// Fungsi fs.readdir di sini akan gagal jika mencoba membaca folder deployment, 
// lebih baik menggantinya dengan GitHub API jika tujuan utama adalah GitHub.
app.get('/api/files', async (req, res) => {
    // Implementasi Octokit yang benar harus di sini
    const userDir = req.query.directory || ''; // Path/folder di GitHub repo
    
    try {
        const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner: OWNER,
            repo: REPO,
            path: userDir, // Folder/path di repo
            headers: { 'X-GitHub-Api-Version': '2022-11-28' }
        });

        // Mapping response GitHub ke format yang Anda inginkan
        const fileList = response.data.map(item => ({
            name: item.name,
            isDir: item.type === 'dir'
        }));
        
        res.json({ success: true, files: fileList, relativeDir: userDir });

    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url}: Gagal membaca direktori GitHub.`, error.message);
        console.error(error.stack);
        res.status(error.status || 500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal membaca konten GitHub. Cek GITHUB_TOKEN/Repo/Path.`, 
            error_type: error.status || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});

// 3. API: Mendapatkan Konten File (HARUS DIGANTI DENGAN OCTOKIT)
app.get('/api/file-content', async (req, res) => {
    const fileName = req.query.file;
    if (!fileName) return res.status(400).json({ success: false, message: 'Nama file diperlukan.' });

    try {
        const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner: OWNER,
            repo: REPO,
            path: fileName,
            headers: { 'X-GitHub-Api-Version': '2022-11-28' }
        });
        
        if (response.data.content) {
            const content = Buffer.from(response.data.content, 'base64').toString('utf8');
            res.json({ 
                success: true, 
                content: content, 
                sha: response.data.sha // SHA PENTING UNTUK EDIT/SIMPAN
            });
        } else {
            res.status(404).json({ success: false, message: 'File ditemukan, tetapi bukan file atau konten kosong.' });
        }

    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url}: Gagal membaca file GitHub.`, error.message);
        console.error(error.stack);
        res.status(error.status || 500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal membaca file dari GitHub.`, 
            error_type: error.status || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});

// 4. API: Menyimpan/Membuat File (HARUS DIGANTI DENGAN OCTOKIT)
app.post('/api/save-file', async (req, res) => {
    const { file_name, content, sha } = req.body; // Butuh SHA dari client

    if (!file_name || content === undefined || !sha) {
        return res.status(400).json({ success: false, message: 'Nama file, konten, dan SHA (untuk update) diperlukan.' });
    }
    
    const encodedContent = Buffer.from(content, 'utf8').toString('base64');
    
    try {
        const response = await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
            owner: OWNER,
            repo: REPO,
            path: file_name,
            message: `[Vercel Editor] Updated ${file_name}`, 
            content: encodedContent,
            sha: sha, // SHA diperlukan untuk update
            headers: { 'X-GitHub-Api-Version': '2022-11-28' }
        });
        
        res.json({ 
            success: true, 
            message: 'File berhasil disimpan ke GitHub.', 
            new_sha: response.data.content.sha 
        });

    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url}: Gagal menyimpan file GitHub.`, error.message);
        console.error(error.stack);
        res.status(error.status || 500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal menyimpan file ke GitHub.`, 
            error_type: error.status || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});


// 5. API: Membuat Folder (API GitHub tidak memiliki konsep "buat folder", melainkan buat/simpan file di path baru)
// API ini dihapus karena fungsionalitasnya ada di save-file

// 6. API: Menghapus File/Folder (HARUS DIGANTI DENGAN OCTOKIT)
app.delete('/api/delete', async (req, res) => {
    const { file, sha } = req.query; // Butuh SHA dari client

    if (!file || !sha) return res.status(400).json({ success: false, message: 'Nama file dan SHA diperlukan untuk menghapus di GitHub.' });
    
    try {
        await octokit.request('DELETE /repos/{owner}/{repo}/contents/{path}', {
            owner: OWNER,
            repo: REPO,
            path: file,
            message: `[Vercel Editor] Deleted ${file}`, 
            sha: sha, // SHA diperlukan untuk penghapusan
            headers: { 'X-GitHub-Api-Version': '2022-11-28' }
        });
        
        res.json({ success: true, message: `File/Folder '${file}' berhasil dihapus dari GitHub.` });
    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url}: Gagal menghapus file GitHub.`, error.message);
        console.error(error.stack);
        res.status(error.status || 500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal menghapus file dari GitHub.`, 
            error_type: error.status || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});


// 7, 8, 9 API lainnya (upload, download, rename) memerlukan implementasi Octokit yang lebih kompleks atau fungsionalitas khusus, 
// sementara ini API 7, 8, 9 yang tersisa DIANGGAP TIDAK BERFUNGSI untuk GitHub dan dikomentari/dihapus untuk menghindari kebingungan.
// Untuk rename di GitHub, Anda harus delete file lama dan create file baru.


// PENTING: Mengekspor aplikasi Express agar Vercel dapat menjalankannya
module.exports = app;
