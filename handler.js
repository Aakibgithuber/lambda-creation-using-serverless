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

  // Paths for required files
  const templatePath = path.join(__dirname, "template.hbs");
  const cssPath = path.join(__dirname, "styles.css");
  const logoPath = path.join(__dirname, "logo.png");
  const tickPath = path.join(__dirname, "tick.png");

  // Paths for all partials
  const partials = {
    "client-info": path.join(__dirname, "partials", "client-info.hbs"),
    "product-info": path.join(__dirname, "partials", "product-info.hbs"),
    "expiring-premium": path.join(__dirname, "partials", "expiring-premium.hbs"),
    "lives-info": path.join(__dirname, "partials", "lives-info.hbs"),
    "claim-information": path.join(__dirname, "partials", "claim-information.hbs"),
    "coverages": path.join(__dirname, "partials", "coverages.hbs"),
    "premium": path.join(__dirname, "partials", "premium.hbs"),
    "documents": path.join(__dirname, "partials", "documents.hbs"),
  };

  // Ensure all required files exist
  const requiredFiles = [templatePath, cssPath, logoPath, tickPath, ...Object.values(partials)];
  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      console.error(`❌ Required file missing: ${file}`);
      return { statusCode: 500, body: `Some required files are missing in Lambda package.` };
    }
  }

  // ✅ Registering partials dynamically
  for (const [name, filePath] of Object.entries(partials)) {
    const source = fs.readFileSync(filePath, "utf8");
    handlebars.registerPartial(name, source);
  }

  // Read main template
  const templateSource = fs.readFileSync(templatePath, "utf8");
  const cssContent = fs.readFileSync(cssPath, "utf8");
  const template = handlebars.compile(templateSource);

  // Encode images in Base64
  const imageSrc = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  const tickSrc = `data:image/png;base64,${fs.readFileSync(tickPath).toString("base64")}`;

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
