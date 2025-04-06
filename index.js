const express = require('express');
const multer = require('multer');
const cors = require('cors');
const dotenv = require('dotenv');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

dotenv.config();
const app = express();

// Todo: Add CORS Configuration in production
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

// Configure S3Client for Cloudflare R2
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Multer Storage & File Type Filtering
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only images are allowed!'));
    }
    cb(null, true);
  },
});

// Rate Limiter for Uploads
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many uploads from this IP, please try again later.',
});

// Upload File to R2
app.post('/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('❌ No file received in the request.');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate a random filename
    const fileExt = req.file.originalname.split('.').pop();
    const safeFileName = `${crypto.randomBytes(10).toString('hex')}.${fileExt}`;

    console.log('✅ File received:', safeFileName);

    const params = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: safeFileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'private',
    };

    const command = new PutObjectCommand(params);
    await s3.send(command);

    console.log('✅ File uploaded to R2:', safeFileName);

    res.json({ filename: safeFileName });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete File from R2
app.delete('/delete', async (req, res) => {
  const { filename } = req.body;
  console.log('filename', filename);

  if (!filename) {
    return res.status(400).json({ message: 'Filename is required.' });
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: filename,
    });

    await s3.send(command);

    console.log('✅ File deleted from R2:', filename);
    return res.status(200).json({ message: 'File deleted successfully.' });
  } catch (error) {
    console.error('❌ Error deleting file from R2:', error);
    return res.status(500).json({ message: 'Failed to delete file.' });
  }
});

// Generate Signed URL for Private Files
app.get('/signed-url', async (req, res) => {
  try {
    const { filename } = req.query;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const params = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: filename,
    };

    const command = new GetObjectCommand(params);
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1-hour expiration

    res.json({ url });
  } catch (error) {
    console.error('❌ Signed URL error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-email', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"A Witch's Grimoire" <${process.env.SMTP_USER}>`,
      to: 'awitchsgrimoire.dev@gmail.com',
      subject: `New Contact Form Submission from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully!');
    res.json({ success: 'Email sent successfully!' });
  } catch (error) {
    console.error('❌ Email error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
