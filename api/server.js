// server.js (Dioptimalkan untuk Vercel)

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');

const app = express();
// PORT tidak diperlukan di Vercel, cukup hapus atau biarkan sebagai komentar

// --- KONFIGURASI PATH AMAN ---
// Di Vercel, kita berasumsi DOCUMENT_ROOT adalah direktori proyek saat runtime
const DOCUMENT_ROOT = path.resolve(__dirname); 

// Middleware untuk parsing body JSON dan URL-encoded
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// PENTING: Middleware untuk melayani aset statis
// Ini menangani file seperti index.html, CSS, dan JS yang diminta oleh browser,
// terutama jika rute fallback vercel.json diarahkan ke server.js
app.use(express.static(DOCUMENT_ROOT));


// Konfigurasi Multer untuk upload file
// Catatan Vercel: Operasi file hanya akan berhasil di /tmp
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Mengarahkan file ke direktori sementara Vercel /tmp untuk upload
        cb(null, '/tmp/'); 
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Fungsi utilitas untuk validasi keamanan path
function getSafePath(userPath) {
    // Di Vercel, penyimpanan permanen tidak mungkin, jadi kita batasi ke DOCUMENT_ROOT atau /tmp
    const targetPath = userPath.startsWith('/') ? userPath.substring(1) : userPath;
    let fullPath = path.join(DOCUMENT_ROOT, targetPath);

    // Untuk memastikan operasi file (rename, delete, save) ditujukan ke lokasi yang diizinkan (DI VERCEL HANYA /tmp)
    // Karena ini adalah File Editor, kita harus mengakui bahwa fitur ini tidak akan berfungsi 
    // untuk penyimpanan permanen di Vercel secara default. 
    // Kita akan tetap menggunakan batasan DOCUMENT_ROOT untuk file yang sudah ada.
    if (!fullPath.startsWith(DOCUMENT_ROOT)) {
        return DOCUMENT_ROOT; 
    }
    return fullPath; 
}

// Fungsi utilitas untuk mendapatkan path relatif dari DOCUMENT_ROOT
function getRelativePath(absolutePath) {
    return '/' + path.relative(DOCUMENT_ROOT, absolutePath).replace(/\\/g, '/');
}


// --- ROUTES EXPRESS ---

// 1. Route untuk menyajikan file statis (index.html) - HAPUS JIKA MENGGUNAKAN VERSEL.JSON STATIS
// Jika Anda menggunakan vercel.json yang diarahkan ke /index.html (seperti yang disarankan):
// app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); }); 
// BARIS INI TIDAK DIPERLUKAN LAGI KARENA app.use(express.static...) sudah menangani serving index.html


// 2. API: Mendapatkan Daftar File (dan rute API lainnya...)
// ... (Semua rute API 2 hingga 9 tetap sama) ...

app.get('/api/files', async (req, res) => {
    const userDir = req.query.directory || './';
    const safeDir = getSafePath(userDir);
    // ... (rest of the logic) ...
    try {
        const files = await fs.readdir(safeDir);
        const fileList = [];
        
        for (const file of files) {
            if (file === '.' || file === '..') continue;
            const fullPath = path.join(safeDir, file);
            const stats = await fs.stat(fullPath);

            fileList.push({
                name: file,
                isDir: stats.isDirectory()
            });
        }
        
        res.json({ success: true, files: fileList, relativeDir: getRelativePath(safeDir) });

    } catch (error) {
        console.error('Error reading directory:', error);
        res.status(500).json({ success: false, message: 'Gagal membaca direktori.', error: error.message });
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
        console.error('Error reading file:', error);
        res.status(500).json({ success: false, message: 'Gagal membaca file.', error: error.message });
    }
});

// 4. API: Menyimpan/Membuat File
app.post('/api/save-file', async (req, res) => {
    const { file_name, content, directory } = req.body;

    if (!file_name || content === undefined) {
        return res.status(400).json({ success: false, message: 'Nama file dan konten diperlukan.' });
    }

    // PENTING: Perubahan Vercel: penyimpanan hanya sementara di /tmp
    const filePath = path.join('/tmp/', file_name); // Ganti dari getSafePath

    try {
        await fs.writeFile(filePath, content);
        res.json({ success: true, message: 'File berhasil disimpan (sementara di /tmp).' });
    } catch (error) {
        console.error('Error writing file:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan file (Izin ditolak?).', error: error.message });
    }
});

// 5. API: Membuat Folder
app.post('/api/create-folder', async (req, res) => {
    const { new_folder, directory } = req.body;
    if (!new_folder) return res.status(400).json({ success: false, message: 'Nama folder diperlukan.' });

    // PENTING: Perubahan Vercel: buat folder di /tmp
    const newPath = path.join('/tmp/', new_folder); // Ganti dari getSafePath

    try {
        await fs.mkdir(newPath, { recursive: true });
        res.json({ success: true, message: `Folder '${new_folder}' berhasil dibuat (sementara di /tmp).` });
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ success: false, message: `Gagal membuat folder: ${error.message}` });
    }
});

// 6. API: Menghapus File/Folder
app.delete('/api/delete', async (req, res) => {
    const { file, directory } = req.query; 

    if (!file) return res.status(400).json({ success: false, message: 'Nama file/folder diperlukan.' });
    
    // PENTING: Asumsi menghapus dari /tmp untuk file yang dibuat saat runtime,
    // atau dari DOCUMENT_ROOT jika file adalah bagian dari deployment (yang akan gagal).
    const delPath = path.join('/tmp/', file); // Lebih aman mengasumsikan /tmp

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
        console.error('Error deleting file/folder:', error);
        res.status(500).json({ success: false, message: `Gagal menghapus: ${error.message}` });
    }
});

// 7. API: Upload File
app.post('/api/upload', upload.array('files'), (req, res) => {
    // Multer sudah dikonfigurasi untuk menyimpan di /tmp
    const uploadedNames = req.files.map(f => f.filename);
    res.json({ success: true, message: `Upload ${uploadedNames.length} file berhasil.` });
});

// 8. API: Download File
app.get('/api/download', (req, res) => {
    const userDir = req.query.directory || './';
    const fileName = req.query.file;

    if (!fileName) return res.status(400).send('Nama file diperlukan.');

    // PENTING: Mengunduh dari /tmp untuk file yang baru dibuat
    const filePath = path.join('/tmp/', fileName);
    
    res.download(filePath, fileName, (err) => {
        if (err) {
            console.error('Error during download:', err);
            res.status(500).send('Gagal mengunduh file. (Mungkin file tidak ada di /tmp).');
        }
    });
});

// 9. API: Rename File/Folder (Baru)
app.put('/api/rename', async (req, res) => {
    const { old_name, new_name, directory } = req.body;
    
    if (!old_name || !new_name) {
        return res.status(400).json({ success: false, message: 'Nama lama dan nama baru diperlukan.' });
    }

    // PENTING: Mengganti nama di /tmp
    const oldPath = path.join('/tmp/', old_name);
    const newPath = path.join('/tmp/', new_name);

    try {
        await fs.rename(oldPath, newPath);
        res.json({ success: true, message: `Berhasil mengganti nama dari '${old_name}' menjadi '${new_name}'.` });
    } catch (error) {
        console.error('Error renaming file/folder:', error);
        res.status(500).json({ success: false, message: `Gagal mengganti nama: ${error.message}` });
    }
});

// HAPUS BAGIAN app.listen(PORT, ...)

// PENTING: Mengekspor aplikasi Express agar Vercel dapat menjalankannya
module.exports = app;
