// server.js (Dioptimalkan untuk Vercel dengan Logging Detail)

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');

const app = express();
const DOCUMENT_ROOT = path.resolve(__dirname); 

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

// PENTING: Middleware untuk melayani aset statis (termasuk index.html, JS, CSS)
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


// Fungsi utilitas untuk validasi keamanan path (getSafePath, getRelativePath)
// ... (fungsi utilitas tetap sama) ...
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

// 1. Route Fallback untuk root / (Jika express.static gagal, ini menjamin index.html terlayani)
app.get('/', (req, res) => {
    res.sendFile(path.join(DOCUMENT_ROOT, 'index.html'));
});


// 2. API: Mendapatkan Daftar File
app.get('/api/files', async (req, res) => {
    const userDir = req.query.directory || './';
    const safeDir = getSafePath(userDir);

    try {
        const files = await fs.readdir(safeDir);
        const fileList = [];
        
        for (const file of files) {
            if (file === '.' || file === '..') continue;
            const fullPath = path.join(safeDir, file);
            const stats = await fs.stat(fullPath);

            fileList.push({ name: file, isDir: stats.isDirectory() });
        }
        
        res.json({ success: true, files: fileList, relativeDir: getRelativePath(safeDir) });

    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url} (safeDir: ${safeDir}):`, error.message);
        console.error(error.stack);
        res.status(500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal membaca direktori. Cek log Vercel.`, 
            error_type: error.code || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});

// 3. API: Mendapatkan Konten File
app.get('/api/file-content', async (req, res) => {
    const userDir = req.query.directory || './';
    const fileName = req.query.file;

    if (!fileName) return res.status(400).json({ success: false, message: 'Nama file diperlukan.' });

    const filePath = path.join(getSafePath(userDir), fileName);

    try {
        const content = await fs.readFile(filePath, 'utf8');
        res.json({ success: true, content });
    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url} (filePath: ${filePath}):`, error.message);
        console.error(error.stack);
        res.status(500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal membaca file. Cek log Vercel.`, 
            error_type: error.code || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});

// 4. API: Menyimpan/Membuat File (ke /tmp)
app.post('/api/save-file', async (req, res) => {
    const { file_name, content } = req.body;
    if (!file_name || content === undefined) {
        return res.status(400).json({ success: false, message: 'Nama file dan konten diperlukan.' });
    }
    const filePath = path.join('/tmp/', file_name);

    try {
        await fs.writeFile(filePath, content);
        res.json({ success: true, message: 'File berhasil disimpan (sementara di /tmp).' });
    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url} (filePath: ${filePath}):`, error.message);
        console.error(error.stack);
        res.status(500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal menyimpan file (Izin ditolak?). Cek log Vercel.`, 
            error_type: error.code || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});

// 5. API: Membuat Folder (di /tmp)
app.post('/api/create-folder', async (req, res) => {
    const { new_folder } = req.body;
    if (!new_folder) return res.status(400).json({ success: false, message: 'Nama folder diperlukan.' });

    const newPath = path.join('/tmp/', new_folder);

    try {
        await fs.mkdir(newPath, { recursive: true });
        res.json({ success: true, message: `Folder '${new_folder}' berhasil dibuat (sementara di /tmp).` });
    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url} (newPath: ${newPath}):`, error.message);
        console.error(error.stack);
        res.status(500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal membuat folder. Cek log Vercel.`, 
            error_type: error.code || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});

// 6. API: Menghapus File/Folder (dari /tmp)
app.delete('/api/delete', async (req, res) => {
    const { file } = req.query; 

    if (!file) return res.status(400).json({ success: false, message: 'Nama file/folder diperlukan.' });
    
    const delPath = path.join('/tmp/', file);

    try {
        const stats = await fs.stat(delPath);
        if (stats.isDirectory()) {
            await fs.rm(delPath, { recursive: true, force: true });
            res.json({ success: true, message: `Folder '${file}' berhasil dihapus.` });
        } else {
            await fs.unlink(delPath);
            res.json({ success: true, message: `File '${file}' berhasil dihapus.` });
        }
    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url} (delPath: ${delPath}):`, error.message);
        console.error(error.stack);
        res.status(500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal menghapus. Cek log Vercel.`, 
            error_type: error.code || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});

// 7. API: Upload File (ke /tmp)
app.post('/api/upload', upload.array('files'), (req, res) => {
    try {
        const uploadedNames = req.files.map(f => f.filename);
        res.json({ success: true, message: `Upload ${uploadedNames.length} file berhasil.` });
    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url} (Upload):`, error.message);
        console.error(error.stack);
        res.status(500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal upload file. Cek log Vercel.`, 
            error_type: error.code || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});

// 8. API: Download File (dari /tmp)
app.get('/api/download', (req, res) => {
    const fileName = req.query.file;
    if (!fileName) return res.status(400).send('Nama file diperlukan.');
    const filePath = path.join('/tmp/', fileName);
    
    res.download(filePath, fileName, (err) => {
        if (err) {
            console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url} (Download filePath: ${filePath}):`, err.message);
            console.error(err.stack);
            // Kirim respons 500 hanya jika header belum dikirim (pencegahan crash)
            if (!res.headersSent) {
                res.status(500).send('Gagal mengunduh file. Cek log Vercel.');
            }
        }
    });
});

// 9. API: Rename File/Folder (di /tmp)
app.put('/api/rename', async (req, res) => {
    const { old_name, new_name } = req.body;
    
    if (!old_name || !new_name) {
        return res.status(400).json({ success: false, message: 'Nama lama dan nama baru diperlukan.' });
    }

    const oldPath = path.join('/tmp/', old_name);
    const newPath = path.join('/tmp/', new_name);

    try {
        await fs.rename(oldPath, newPath);
        res.json({ success: true, message: `Berhasil mengganti nama dari '${old_name}' menjadi '${new_name}'.` });
    } catch (error) {
        console.error(`[FATAL ERROR] Gagal pada rute ${req.method} ${req.url} (oldPath: ${oldPath}):`, error.message);
        console.error(error.stack);
        res.status(500).json({ 
            success: false, 
            message: `[SERVER ERROR] Gagal mengganti nama. Cek log Vercel.`, 
            error_type: error.code || 'UNKNOWN',
            internal_message: error.message 
        });
    }
});


// PENTING: Mengekspor aplikasi Express agar Vercel dapat menjalankannya
module.exports = app;
