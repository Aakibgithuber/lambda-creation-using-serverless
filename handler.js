const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");

module.exports.main = async (event) => {
  // AWS S3 Client
  const s3Client = new S3Client({ region: process.env.AWS_BUCKET_REGION });

  // Parse JSON Input
  const jsonData = JSON.parse(event.body || "{}");

  // File Paths
  const templatePath = path.join(__dirname, "template.hbs");
  const cssPath = path.join(__dirname, "styles.css");
  const logoPath = path.join(__dirname, "logo.png");

  // Check File Existence
  if (!fs.existsSync(templatePath) || !fs.existsSync(cssPath) || !fs.existsSync(logoPath)) {
    console.error("Template, CSS, or Logo file missing!");
    return { statusCode: 500, body: "Required files missing in Lambda package." };
  }

  // Read & Compile Handlebars Template
  const templateSource = fs.readFileSync(templatePath, "utf8");
  const cssContent = fs.readFileSync(cssPath, "utf8");
  const template = handlebars.compile(templateSource);

  // Encode Image to Base64 (Safe for Lambda)
  const imageBuffer = fs.readFileSync(logoPath);
  const imageBase64 = imageBuffer.toString("base64");
  const imageSrc = `data:image/png;base64,${imageBase64}`;

  // Generate Final HTML
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

  // Start Puppeteer Browser
  const browser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  try {
    // Load HTML into Puppeteer
    await page.setContent(finalHtml, { waitUntil: "load" });

    // Convert to PDF
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,  // CSS Backgrounds Enable
      margin: { top: "20px", right: "10px", bottom: "20px", left: "10px" }, // Proper Margins
      preferCSSPageSize: true // CSS mein set page size prefer karega
    });

    // Upload to S3
    const bucketName = process.env.AWS_BUCKET_NAME;
    const pdfKey = `${jsonData.name}_${Date.now()}.pdf`;

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: pdfKey,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    }));

    console.log("✅ PDF uploaded successfully:", pdfKey);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "PDF uploaded successfully!", file: pdfKey }),
    };
  } catch (error) {
    console.error("❌ Error generating PDF:", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Error generating PDF." }) };
  } finally {
    await browser.close();
  }
};
