let startTime;
let processedCount = 0;
let totalBusinesses = 0;
let estimatedTime = "Calculating...";
let scrapingInProgress = false;
let emailSendingInProgress = false;
let emailTemplate = "";
let isLoggedIn = false;
let userProfile = null;

// Initialize app
function initializeApp() {
    updateSendEmailsButton();
    loadEmailTemplate();
    updateAuthUI();
    setupEventListeners();
}

function setupEventListeners() {
    // Button event listeners
    document.getElementById('searchBtn').addEventListener('click', runScraper);
    document.getElementById('cancelAllBtn').addEventListener('click', cancelAllProcesses);
    document.getElementById('authBtn').addEventListener('click', authenticateGoogle);
    document.getElementById('selectAll').addEventListener('change', toggleSelectAll);
    document.getElementById('removeSelectedBtn').addEventListener('click', removeSelected);
    document.getElementById('sendEmailsBtn').addEventListener('click', sendEmails);
    document.getElementById('importBtn').addEventListener('click', importFile);
    document.getElementById('clearBtn').addEventListener('click', clearTable);
    document.getElementById('templateBtn').addEventListener('click', openEmailTemplateModal);
    document.getElementById('downloadBtn').addEventListener('click', downloadData);
    document.getElementById('viewHistoryBtn').addEventListener('click', openEmailHistoryModal);
    document.getElementById('fileInput').addEventListener('change', handleFileImport);
    document.getElementById('closeModal').addEventListener('click', closeEmailTemplateModal);
    document.getElementById('cancelModalBtn').addEventListener('click', closeEmailTemplateModal);
    document.getElementById('saveTemplateBtn').addEventListener('click', saveEmailTemplate);
    document.getElementById('closeHistoryModal').addEventListener('click', closeEmailHistoryModal);
    document.getElementById('closeHistoryModalBtn').addEventListener('click', closeEmailHistoryModal);
    document.getElementById('refreshHistoryBtn').addEventListener('click', refreshEmailHistory);
    document.getElementById('historySearch').addEventListener('input', filterHistoryTable);

    // Enter key for search
    document.getElementById('searchQuery').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') runScraper();
    });

    // Company search filter
    document.getElementById('companySearch').addEventListener('input', filterTable);

    // IPC event listeners
    window.electronAPI.onScraperStatus((event, message) => {
        document.getElementById("status").innerText = `⏳ ${message}`;
    });

    window.electronAPI.onEstimatedTime((event, estimatedTimeMinutes) => {
        estimatedTime = `${estimatedTimeMinutes} min remaining`;
        document.getElementById("status").innerText = `⏳ Scraping... ${estimatedTime}`;
    });

    window.electronAPI.onScraperProgress((event, progress) => {
        processedCount++;
        totalBusinesses = progress.total;

        let elapsedTime = (Date.now() - startTime) / 1000;
        let avgTimePerBusiness = elapsedTime / processedCount;
        let timeRemaining = avgTimePerBusiness * (totalBusinesses - processedCount);

        estimatedTime = timeRemaining > 60
            ? `${Math.ceil(timeRemaining / 60)} min remaining`
            : `${Math.ceil(timeRemaining)} sec remaining`;

        document.getElementById("status").innerText = `⏳ Scraping... ${processedCount}/${totalBusinesses} completed. ${estimatedTime}`;
    });

    window.electronAPI.onScraperResults((event, data) => {
        populateTable(data);
        scrapingInProgress = false;
        document.getElementById("status").innerText = "✅ Extraction complete!";
        updateSendEmailsButton();
    });

    window.electronAPI.onAuthSuccess((event, userInfo) => {
        isLoggedIn = true;
        userProfile = userInfo;
        updateSendEmailsButton();
        updateAuthUI();
        document.getElementById("status").innerText = `✅ Logged in as ${userInfo.name}`;
    });

    window.electronAPI.onAuthError((event, error) => {
        isLoggedIn = false;
        userProfile = null;
        updateAuthUI();
        document.getElementById("status").innerText = `❌ Authentication failed: ${error}`;
    });

    window.electronAPI.onEmailProgress((event, progress) => {
        document.getElementById("status").innerText = `📧 Sending emails... ${progress.sent}/${progress.total} (${progress.current})`;
    });

    window.electronAPI.onEmailStatus((event, message) => {
        document.getElementById("status").innerText = message;
        emailSendingInProgress = false;
        document.getElementById('sendEmailsBtn').disabled = false;
        updateSendEmailsButton();
    });

    window.electronAPI.onDownloadStatus((event, message) => {
        document.getElementById("status").innerText = message;
    });
}

function updateSendEmailsButton() {
    const sendBtn = document.getElementById('sendEmailsBtn');
    const hasData = document.querySelectorAll("#resultsTable tbody tr").length > 0;

    // Only require login and data - email template is optional (has default)
    sendBtn.disabled = !isLoggedIn || !hasData;
}

function runScraper() {
    const query = document.getElementById("searchQuery").value.trim();
    if (!query) {
        document.getElementById("status").innerText = "⚠️ Please enter a search term!";
        return;
    }

    scrapingInProgress = true;
    document.getElementById("status").innerText = "⏳ Running scraper... Estimating time...";

    startTime = Date.now();
    processedCount = 0;
    estimatedTime = "Calculating...";

    window.electronAPI.runScraper(query);
}

function cancelAllProcesses() {
    if (scrapingInProgress) {
        window.electronAPI.cancelScraper();
        scrapingInProgress = false;
        document.getElementById("status").innerText = "❌ Scraping cancelled by user";
    }
    if (emailSendingInProgress) {
        window.electronAPI.cancelEmails();
        emailSendingInProgress = false;
    }
}

function authenticateGoogle() {
    if (isLoggedIn) {
        logout();
    } else {
        window.electronAPI.googleAuth();
    }
}

function logout() {
    isLoggedIn = false;
    userProfile = null;
    updateSendEmailsButton();
    updateAuthUI();
}

function updateAuthUI() {
    const authBtn = document.getElementById('authBtn');
    const profilePic = document.getElementById('profilePic');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');

    if (isLoggedIn && userProfile) {
        profilePic.textContent = userProfile.name ? userProfile.name.charAt(0).toUpperCase() : '?';
        userName.textContent = userProfile.name || 'Unknown User';
        userEmail.textContent = userProfile.email || 'No email';
        authBtn.textContent = 'Logout';
    } else {
        profilePic.textContent = '?';
        userName.textContent = 'Not logged in';
        userEmail.textContent = 'Please authenticate';
        authBtn.textContent = 'Login';
    }
}

function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('selectAll');
    const rowCheckboxes = document.querySelectorAll('.row-checkbox');

    rowCheckboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });
}

function removeSelected() {
    const rowCheckboxes = document.querySelectorAll('.row-checkbox:checked');
    rowCheckboxes.forEach(checkbox => {
        checkbox.closest('tr').remove();
    });

    document.getElementById('selectAll').checked = false;
    updateSendEmailsButton();
}

function filterTable() {
    const filterValue = document.getElementById('companySearch').value.toLowerCase();
    const rows = document.querySelectorAll("#resultsTable tbody tr");

    rows.forEach(row => {
        const companyName = row.cells[1].textContent.toLowerCase();
        row.style.display = companyName.includes(filterValue) ? '' : 'none';
    });
}

function populateTable(data) {
    const tableBody = document.querySelector("#resultsTable tbody");
    tableBody.innerHTML = "";

    data.forEach(business => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="checkbox-cell"><input type="checkbox" class="row-checkbox"></td>
            <td>${business.storeName || "N/A"}</td>
            <td>${business.phone || "No info"}</td>
            <td>${business.email || "No info"}</td>
            <td>${business.address || "No info"}</td>
            <td>${business.bizWebsite ? `<a href='${business.bizWebsite}' target='_blank'>Website</a>` : "No info"}</td>
        `;
        tableBody.appendChild(row);
    });
}

function sendEmails() {
    if (!isLoggedIn) {
        alert("Please log in with your Google account first");
        return;
    }

    // Use default template if no custom template is set
    let currentTemplate = emailTemplate.trim();
    if (!currentTemplate) {
        currentTemplate = `Good Day, {companyName}!

We hope this message finds you well. We are reaching out to explore potential business opportunities and discuss how we can support your company's growth.

Your business has caught our attention, and we believe there may be valuable synergies between our organizations. We would love to schedule a brief conversation to learn more about your needs and share how our services might benefit {companyName}.

Please let us know if you would be interested in a short discussion at your convenience.

Best regards,
Your Name`;
    }

    const rows = document.querySelectorAll("#resultsTable tbody tr");
    if (rows.length === 0) {
        alert("No data available to send emails");
        return;
    }

    const selectedRows = document.querySelectorAll('.row-checkbox:checked');
    const targetRows = selectedRows.length > 0 ? selectedRows : document.querySelectorAll('.row-checkbox');

    const emailData = [];
    targetRows.forEach(checkbox => {
        const row = checkbox.closest('tr');
        const cells = row.querySelectorAll('td');
        const email = cells[3].textContent.trim();

        if (email && email !== "No info" && email !== "Fetching...") {
            emailData.push({
                companyName: cells[1].textContent.trim(),
                phone: cells[2].textContent.trim(),
                email: email,
                address: cells[4].textContent.trim(),
                website: cells[5].textContent.trim().replace('Website', '')
            });
        }
    });

    if (emailData.length === 0) {
        alert("No valid email addresses found in selected rows");
        return;
    }

    if (confirm(`Send emails to ${emailData.length} recipients?`)) {
        emailSendingInProgress = true;
        document.getElementById('sendEmailsBtn').disabled = true;

        // Retrieve email subject from localStorage
        const emailSubject = localStorage.getItem('emailSubject') || "Business Inquiry for {companyName}";

        emailData.forEach(data => {
          const emailSubjectProcessed = emailSubject
          .replace(/{companyName}/g, data.companyName || "")
          .replace(/{email}/g, data.email || "")
          .replace(/{phone}/g, data.phone || "")
          .replace(/{address}/g, data.address || "")
          .replace(/{website}/g, data.website || "");

        const emailContentProcessed = currentTemplate
          .replace(/{companyName}/g, data.companyName || "")
          .replace(/{email}/g, data.email || "")
          .replace(/{phone}/g, data.phone || "")
          .replace(/{address}/g, data.address || "")
          .replace(/{website}/g, data.website || "");

        const emailMessage = [
          `To: ${data.email}`,
          `Subject: ${emailSubjectProcessed}`,
          `Content-Type: text/html; charset="UTF-8"`,
          '',
          emailContentProcessed
        ].join('\n');
            window.electronAPI.sendEmails({ emailData: [data], template: emailMessage });
        });
    }
}

function importFile() {
    document.getElementById('fileInput').click();
}

function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            populateTableFromImport(jsonData);
            document.getElementById('statusMessage').textContent = "✅ Data imported successfully!";
            updateSendEmailsButton();
        } catch (error) {
            alert("Error importing file: " + error.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function populateTableFromImport(data) {
    const tableBody = document.querySelector("#resultsTable tbody");
    tableBody.innerHTML = "";

    data.forEach(row => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td class="checkbox-cell"><input type="checkbox" class="row-checkbox"></td>
            <td>${row['Company Name'] || row.storeName || "N/A"}</td>
            <td>${row['Phone Number'] || row.phone || "No info"}</td>
            <td>${row['Email Address'] || row.email || "No info"}</td>
            <td>${row['Company Address'] || row.address || "No info"}</td>
            <td>${row['Business Website'] || row.bizWebsite ? `<a href='${row['Business Website'] || row.bizWebsite}' target='_blank'>Website</a>` : "No info"}</td>
        `;
        tableBody.appendChild(tr);
    });
}

function clearTable() {
    if (confirm("Are you sure you want to clear all table data?")) {
        document.querySelector("#resultsTable tbody").innerHTML = "";
        document.getElementById('selectAll').checked = false;
        updateSendEmailsButton();
    }
}

function openEmailTemplateModal() {
    document.getElementById('emailTemplateModal').style.display = 'block';
    document.getElementById('emailTemplateText').value = emailTemplate;

    // Add input for email subject
    const subjectInput = document.createElement('input');
    subjectInput.type = 'text';
    subjectInput.id = 'emailSubject';
    subjectInput.placeholder = 'Enter email subject';
    subjectInput.style.width = '100%';
    subjectInput.style.marginBottom = '10px';
    subjectInput.value = localStorage.getItem('emailSubject') || ""; // Load saved subject
    document.getElementById('emailTemplateModal').insertBefore(subjectInput, document.getElementById('emailTemplateText'));

    // Add input for image upload
    const imageInput = document.createElement('input');
    imageInput.type = 'file';
    imageInput.id = 'imageUpload';
    imageInput.accept = 'image/*';
    document.getElementById('emailTemplateModal').appendChild(imageInput);

    // Event listener for image upload
    imageInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                localStorage.setItem('emailFooterImage', e.target.result); // Save image data as base64
            }
            reader.readAsDataURL(file);
        }
    });

    // Set default email content if empty
    if (!document.getElementById('emailTemplateText').value) {
        document.getElementById('emailTemplateText').value = `Good Day, {companyName}!

We hope this message finds you well. We are reaching out to explore potential business opportunities and discuss how we can support your company's growth.

Your business has caught our attention, and we believe there may be valuable synergies between our organizations. We would love to schedule a brief conversation to learn more about your needs and share how our services might benefit {companyName}.

Please let us know if you would be interested in a short discussion at your convenience.

Sincerely yours,

Lydelyn Romero Quitong
Blue Chalcedony Quartz
Licensed insurance agent
Certified Estate and Wealth Planner
Junior Unit Manager`; {companyName}!";
    }
}

function closeEmailTemplateModal() {
    document.getElementById('emailTemplateModal').style.display = 'none';
}

function saveEmailTemplate() {
    emailTemplate = document.getElementById('emailTemplateText').value;
    localStorage.setItem('emailTemplate', emailTemplate);

    // Save email subject
    const emailSubject = document.getElementById('emailSubject').value;
    localStorage.setItem('emailSubject', emailSubject);

    closeEmailTemplateModal();
    updateSendEmailsButton();
    alert("Email template saved successfully!");
}

function loadEmailTemplate() {
    emailTemplate = localStorage.getItem('emailTemplate') || "";
}

function downloadData() {
    const rows = document.querySelectorAll("#resultsTable tbody tr");
    if (rows.length === 0) {
        alert("No data available to download");
        return;
    }

    const data = [];
    rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        data.push({
            "Company Name": cells[1].innerText.trim(),
            "Phone Number": cells[2].innerText.trim(),
            "Email Address": cells[3].innerText.trim(),
            "Company Address": cells[4].innerText.trim(),
            "Business Website": cells[5].innerText.trim()
        });
    });

    window.electronAPI.downloadExcel(data);
}

// Email History Functions
async function openEmailHistoryModal() {
    document.getElementById('emailHistoryModal').style.display = 'block';
    await loadEmailHistory();
}

function closeEmailHistoryModal() {
    document.getElementById('emailHistoryModal').style.display = 'none';
}

async function loadEmailHistory() {
    try {
        const sentEmails = await window.electronAPI.getSentEmails();
        populateHistoryTable(sentEmails);
    } catch (error) {
        console.error('Error loading email history:', error);
        alert('Error loading email history');
    }
}

function populateHistoryTable(sentEmails) {
    const tableBody = document.getElementById('historyTableBody');
    tableBody.innerHTML = '';

    if (sentEmails.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No emails sent yet</td></tr>';
        return;
    }

    sentEmails.forEach(email => {
        const row = document.createElement('tr');
        const sentDate = new Date(email.sent_date).toLocaleString();
        
        row.innerHTML = `
            <td style="padding: 8px; border: 1px solid #ddd;">${email.company_name || 'N/A'}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${email.email_address}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${email.phone_number || 'N/A'}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${sentDate}</td>
            <td style="padding: 8px; border: 1px solid #ddd; max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${email.email_subject || 'N/A'}">${email.email_subject || 'N/A'}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">
                <button class="delete-history-btn" onclick="deleteHistoryRecord(${email.id})" style="background: #ff4444; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer;">Delete</button>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

async function deleteHistoryRecord(id) {
    if (confirm('Are you sure you want to delete this email record?')) {
        try {
            await window.electronAPI.deleteEmailRecord(id);
            await loadEmailHistory(); // Refresh the table
        } catch (error) {
            console.error('Error deleting email record:', error);
            alert('Error deleting email record');
        }
    }
}

async function refreshEmailHistory() {
    await loadEmailHistory();
}

function filterHistoryTable() {
    const filterValue = document.getElementById('historySearch').value.toLowerCase();
    const rows = document.querySelectorAll("#historyTable tbody tr");

    rows.forEach(row => {
        if (row.children.length > 1) { // Skip "no data" row
            const companyName = row.children[0].textContent.toLowerCase();
            const email = row.children[1].textContent.toLowerCase();
            row.style.display = (companyName.includes(filterValue) || email.includes(filterValue)) ? '' : 'none';
        }
    });
}

// Enhanced populateTable to mark already emailed companies
async function populateTable(data) {
    const tableBody = document.querySelector("#resultsTable tbody");
    tableBody.innerHTML = "";

    for (const business of data) {
        const row = document.createElement("tr");
        
        // Check if email was already sent
        let isAlreadySent = false;
        if (business.email && business.email !== "No info" && business.email !== "Fetching...") {
            try {
                isAlreadySent = await window.electronAPI.checkEmailSent(business.email);
            } catch (error) {
                console.error('Error checking email status:', error);
            }
        }
        
        // Add visual indicator for already sent emails
        const sentIndicator = isAlreadySent ? ' ✅' : '';
        const rowClass = isAlreadySent ? 'style="background-color: #e8f5e8;"' : '';
        
        row.innerHTML = `
            <td class="checkbox-cell"><input type="checkbox" class="row-checkbox" ${isAlreadySent ? 'disabled' : ''}></td>
            <td>${business.storeName || "N/A"}${sentIndicator}</td>
            <td>${business.phone || "No info"}</td>
            <td>${business.email || "No info"}</td>
            <td>${business.address || "No info"}</td>
            <td>${business.bizWebsite ? `<a href='${business.bizWebsite}' target='_blank'>Website</a>` : "No info"}</td>
        `;
        
        if (isAlreadySent) {
            row.setAttribute('style', 'background-color: #e8f5e8;');
            row.setAttribute('title', 'Email already sent to this company');
        }
        
        tableBody.appendChild(row);
    }
}

window.addEventListener('load', initializeApp);