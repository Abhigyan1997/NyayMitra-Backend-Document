const nodemailer = require("nodemailer");

exports.sendDocumentEmail = async (to, subject, filePath) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL, pass: process.env.PASS }
  });

  await transporter.sendMail({
    from: process.env.EMAIL,
    to,
    subject,
    text: "Find your legal document attached.",
    attachments: [{ filename: "document.pdf", path: filePath }]
  });
};
