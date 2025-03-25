const { ipcRenderer } = require("electron");

let scrapedData = [];

function startSearch() {
    const query = document.getElementById("searchQuery").value;
    document.getElementById("status").textContent = "Status: Searching...";

    ipcRenderer.send("run-scraper", query);
}

ipcRenderer.on("scraper-status", (event, message) => {
    document.getElementById("status").textContent = `Status: ${message}`;
});

// ✅ DEBUG: Log received scraped data
ipcRenderer.on("scraper-data", (event, data) => {
    console.log("🔹 Received scraped data:", data);
    scrapedData = data; // Store the data for download
});

// ✅ DEBUG: Check if function is called
function downloadData() {
    console.log("🔹 Download button clicked");
    if (scrapedData.length === 0) {
        alert("No data available to download.");
        return;
    }
    console.log("🔹 Sending data to main process for Excel generation");
    ipcRenderer.send("download-excel", scrapedData);
}

// ✅ DEBUG: Show download status
ipcRenderer.on("download-status", (event, message) => {
    console.log("🔹 Download status:", message);
    alert(message);
});
