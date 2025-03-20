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

  // Template and CSS File Path
  const templatePath = path.join(__dirname, "template.hbs");
  const cssPath = path.join(__dirname, "styles.css");
  const logoPath = path.join(__dirname, "logo.png");

  if (!fs.existsSync(templatePath) || !fs.existsSync(cssPath)) {
    console.error("Template or CSS file not found!");
    return { statusCode: 500, body: "Template or CSS file missing in Lambda." };
  }

  // Encode Image to Base64
  let imageSrc = "";
  if (fs.existsSync(logoPath)) {
    const imageBuffer = fs.readFileSync(logoPath);
    const imageBase64 = imageBuffer.toString("base64");
    imageSrc = `data:image/png;base64,${imageBase64}`;
  }

  // Read & Compile Handlebars Template
  const templateSource = fs.readFileSync(templatePath, "utf8");
  const cssContent = fs.readFileSync(cssPath, "utf8");
  const template = handlebars.compile(templateSource);

  // Pass Image and Data to Template
  const htmlContent = template({ ...jsonData, imageSrc });

  const finalHtml = `
    <html>
    <head>
      <style>${cssContent}</style>
    </head>
    <body>
      ${htmlContent}
    </body>
    </html>
  `;

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
    await page.setContent(finalHtml, { waitUntil: "load" });

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
