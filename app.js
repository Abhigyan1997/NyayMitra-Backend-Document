const express = require('express');
const app = express();
const documentRoutes = require('./routes/documents');
const paymentRoutes = require('./routes/paymentRoute');
require('dotenv').config();

app.use(express.json());

const cors = require('cors');
app.use(cors({
    origin: ['http://localhost:3000', 'https://nyaymitra-landing-page-lang-v1.vercel.app', "https://nyaymitra.tech", "www.nyaymitra.tech"],
    credentials: true
}));

app.use('/api/documents', documentRoutes);
app.use('/api/payment', paymentRoutes);



module.exports = app;