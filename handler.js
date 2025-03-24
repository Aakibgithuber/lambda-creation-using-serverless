const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");

module.exports.main = async (event) => {
  const s3Client = new S3Client({ region: process.env.AWS_BUCKET_REGION });
  const jsonData = JSON.parse(event.body || "{}");

  const templatePath = path.join(__dirname, "template.hbs");
  const cssPath = path.join(__dirname, "styles.css");
  const logoPath = path.join(__dirname, "logo.png");
  const tickPath = path.join(__dirname, "tick.png");

  if (!fs.existsSync(templatePath) || !fs.existsSync(cssPath) || !fs.existsSync(logoPath) || !fs.existsSync(tickPath)) {
    console.error("Template, CSS, Logo, or Tick file missing!");
    return { statusCode: 500, body: "Required files missing in Lambda package." };
  }

  const templateSource = fs.readFileSync(templatePath, "utf8");
  const cssContent = fs.readFileSync(cssPath, "utf8");
  const template = handlebars.compile(templateSource);

  const imageBuffer = fs.readFileSync(logoPath);
  const imageBase64 = imageBuffer.toString("base64");
  const imageSrc = `data:image/png;base64,${imageBase64}`;

  const tickBuffer = fs.readFileSync(tickPath);
  const tickBase64 = tickBuffer.toString("base64");
  const tickSrc = `data:image/png;base64,${tickBase64}`;

  const htmlContent = template({ ...jsonData, imageSrc, tickSrc });

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

  const browser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  try {
    await page.setContent(finalHtml, { waitUntil: "load" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", right: "10px", bottom: "20px", left: "10px" },
      scale: 0.9,
      preferCSSPageSize: true
    });

    const bucketName = process.env.AWS_BUCKET_NAME;
    const pdfKey = `${jsonData.name}_${Date.now()}.pdf`;

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: pdfKey,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    }));

    console.log("✅ PDF uploaded successfully:", pdfKey);

    // Generate pre-signed URL (valid for 1 hour)
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: bucketName,
        Key: pdfKey,
      }),
      { expiresIn: 3600 }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "PDF uploaded successfully!",
        file: pdfKey,
        downloadUrl: signedUrl, // User can use this URL to download
      }),
    };
  } catch (error) {
    console.error("❌ Error generating PDF:", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Error generating PDF." }) };
  } finally {
    await browser.close();
  }
};

