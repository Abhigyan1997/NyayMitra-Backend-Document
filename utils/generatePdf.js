const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

exports.generatePdfFromGPT = async (text) => {
  const filePath = path.join(__dirname, `../../pdfs/${Date.now()}.pdf`);
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(filePath));
    doc.fontSize(14).text(text);
    doc.end();
    doc.on('finish', () => resolve(filePath));
  });
};
