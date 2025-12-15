// back-end/utils/imageUtils.js
const fs = require('fs').promises;
const path = require('path');

async function getPicSignatureBase64() {
    const imagePath = path.join(__dirname, '../../front-end/tdd_pic.png'); 
    try {
        const imageBuffer = await fs.readFile(imagePath);
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        return base64Image;
    } catch (error) {
        console.error('Error reading or encoding PIC signature image:', error);
        return null; 
    }
}

async function getDireksiSignatureBase64() {
    const imagePath = path.join(__dirname, '../../front-end/tdd_direksi.png');
    try {
        const imageBuffer = await fs.readFile(imagePath);
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        return base64Image;
    } catch (error) {
        console.error('Error reading or encoding Direksi signature image:', error);
        return null;
    }
}

module.exports = {
    getPicSignatureBase64,
    getDireksiSignatureBase64
};

