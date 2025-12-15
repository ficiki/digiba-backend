const parseRincianBarangString = (rincianBarangString) => {
    const items = [];
    // Regex to match lines like "1. Item Name: Quantity Unit"
    // It tries to capture the item name, quantity, and unit.
    // Handles cases where item name might have colons or quotes.
    const regex = /^\d+\.\s*(.+?):\s*(\d+)\s*([a-zA-Z]+(?:\s*[a-zA-Z]+)*)?$/gm;
    let match;

    const lines = rincianBarangString.split('\n');

    for (const line of lines) {
        match = regex.exec(line.trim());
        if (match) {
            const nama_barang = match[1].trim();
            const jumlah = parseInt(match[2], 10);
            const satuan = match[3] ? match[3].trim() : ''; // Unit is optional

            if (nama_barang && !isNaN(jumlah) && jumlah > 0) {
                items.push({
                    nama_barang: nama_barang,
                    jumlah: jumlah,
                    satuan: satuan,
                    keterangan: '', // Default value, can be expanded if needed
                    status_pemeriksaan: 'belum_diperiksa' // Default status
                });
            }
        } else {
            // If a line doesn't match the regex, we can try to handle it or log a warning.
            // For now, we'll just push it as a generic item if it's not empty,
            // or ignore it, depending on desired strictness.
            // Let's be lenient for now and just add it as an item name if it's not empty.
            if (line.trim() !== '') {
                 items.push({
                    nama_barang: line.trim(),
                    jumlah: 0, // Default to 0 if quantity not found
                    satuan: '',
                    keterangan: 'Format tidak standar',
                    status_pemeriksaan: 'belum_diperiksa'
                });
            }
        }
    }
    return items;
};

module.exports = { parseRincianBarangString };
