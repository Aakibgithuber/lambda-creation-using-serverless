const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");

module.exports.main = async (event) => {
  // AWS S3 Client Setup
  const s3Client = new S3Client({ region: process.env.AWS_BUCKET_REGION });


  const jsonData = JSON.parse(event.body || "{}");

  // Template File Path
  const templatePath = path.join(__dirname, "template.hbs"); // Handlebars Template
  if (!fs.existsSync(templatePath)) {
    console.error("Template file not found!");
    return { statusCode: 500, body: "Template file missing in Lambda." };
  }

  // Read & Compile Handlebars Template
  const templateSource = fs.readFileSync(templatePath, "utf8");
  const template = handlebars.compile(templateSource);
  const htmlContent = template(jsonData);

  // Puppeteer Browser Start
  const browser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  try {
    // Load Generated HTML into Puppeteer
    await page.setContent(htmlContent, { waitUntil: "load" });

    // Convert Page to PDF
    const pdfBuffer = await page.pdf({ format: "A4" });

    // S3 Upload
    const bucketName = process.env.AWS_BUCKET_NAME;
    const pdfKey = `${jsonData.name}_${Date.now()}.pdf`;

    const uploadParams = {
      Bucket: bucketName,
      Key: pdfKey,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    console.log("PDF uploaded successfully!");

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "PDF uploaded successfully!", file: pdfKey }),
    };
  } catch (error) {
    console.error("Error:", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Error generating PDF." }) };
  } finally {
    await browser.close();
  }
};
