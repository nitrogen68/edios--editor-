// server.js (Backend Express.js)

const express = require('express');
const fs = require('fs/promises'); // Untuk operasi file asinkron
const path = require('path');
const multer = require('multer'); // Untuk upload file
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// --- KONFIGURASI PATH AMAN ---
// Asumsi root aplikasi adalah Document Root yang aman
const DOCUMENT_ROOT = path.resolve(__dirname); 

// Middleware untuk parsing body JSON dan URL-encoded
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Konfigurasi Multer untuk upload file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Pastikan path tujuan aman sebelum digunakan
        const safeDir = getSafePath(req.body.directory || './'); 
        cb(null, safeDir);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Fungsi utilitas untuk validasi keamanan path
function getSafePath(userPath) {
    const fullPath = path.join(DOCUMENT_ROOT, userPath.startsWith('/') ? userPath.substring(1) : userPath);
    // Pastikan path yang diminta ada di dalam DOCUMENT_ROOT
    if (fullPath.startsWith(DOCUMENT_ROOT)) {
        return fullPath;
    }
    // Jika tidak aman, kembalikan ke DOCUMENT_ROOT
    return DOCUMENT_ROOT; 
}

// Fungsi utilitas untuk mendapatkan path relatif dari DOCUMENT_ROOT
function getRelativePath(absolutePath) {
    return '/' + path.relative(DOCUMENT_ROOT, absolutePath).replace(/\\/g, '/');
}


// --- ROUTES EXPRESS ---

// 1. Route untuk menyajikan file statis (index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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

    const filePath = path.join(getSafePath(directory || './'), file_name);

    try {
        await fs.writeFile(filePath, content);
        res.json({ success: true, message: 'File berhasil disimpan.' });
    } catch (error) {
        console.error('Error writing file:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan file (Izin ditolak?).', error: error.message });
    }
});

// 5. API: Membuat Folder
app.post('/api/create-folder', async (req, res) => {
    const { new_folder, directory } = req.body;
    if (!new_folder) return res.status(400).json({ success: false, message: 'Nama folder diperlukan.' });

    const newPath = path.join(getSafePath(directory || './'), new_folder);

    try {
        await fs.mkdir(newPath, { recursive: true });
        res.json({ success: true, message: `Folder '${new_folder}' berhasil dibuat.` });
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ success: false, message: `Gagal membuat folder: ${error.message}` });
    }
});

// 6. API: Menghapus File/Folder
app.delete('/api/delete', async (req, res) => {
    const { file, directory } = req.query; // Menggunakan query karena DELETE biasanya tidak memiliki body

    if (!file) return res.status(400).json({ success: false, message: 'Nama file/folder diperlukan.' });
    
    const delPath = path.join(getSafePath(directory || './'), file);

    try {
        const stats = await fs.stat(delPath);
        if (stats.isDirectory()) {
            // Hapus folder rekursif
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
    // Multer telah menangani upload file.
    const uploadedNames = req.files.map(f => f.filename);
    res.json({ success: true, message: `Upload ${uploadedNames.length} file berhasil.` });
});

// 8. API: Download File
app.get('/api/download', (req, res) => {
    const userDir = req.query.directory || './';
    const fileName = req.query.file;

    if (!fileName) return res.status(400).send('Nama file diperlukan.');

    const filePath = path.join(getSafePath(userDir), fileName);
    
    // Memberikan file untuk diunduh
    res.download(filePath, fileName, (err) => {
        if (err) {
            console.error('Error during download:', err);
            res.status(500).send('Gagal mengunduh file.');
        }
    });
});

// 9. API: Rename File/Folder (Baru)
app.put('/api/rename', async (req, res) => {
    const { old_name, new_name, directory } = req.body;
    
    if (!old_name || !new_name) {
        return res.status(400).json({ success: false, message: 'Nama lama dan nama baru diperlukan.' });
    }

    const safeDir = getSafePath(directory || './');
    const oldPath = path.join(safeDir, old_name);
    const newPath = path.join(safeDir, new_name);

    try {
        await fs.rename(oldPath, newPath);
        res.json({ success: true, message: `Berhasil mengganti nama dari '${old_name}' menjadi '${new_name}'.` });
    } catch (error) {
        console.error('Error renaming file/folder:', error);
        res.status(500).json({ success: false, message: `Gagal mengganti nama: ${error.message}` });
    }
});


app.listen(PORT, () => {
    console.log(`Server Express berjalan di http://localhost:${PORT}`);
});
