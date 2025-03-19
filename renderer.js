const { ipcRenderer } = require("electron");

function startSearch() {
    const query = document.getElementById("searchQuery").value;
    document.getElementById("status").textContent = "Status: Searching...";

    ipcRenderer.send("run-scraper", query);
}

ipcRenderer.on("scraper-status", (event, message) => {
    document.getElementById("status").textContent = `Status: ${message}`;
});
