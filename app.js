import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getDatabase, ref, onValue, off, push, update, remove, child, orderByChild, query } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js";

console.log("app.js loaded successfully."); // Diagnostic log to confirm file version
// --- CONFIGURATION ---


const firebaseConfig = { apiKey: "AIzaSyBdiEUorFPkiZAya84Xzx17id82nB77Zg4", authDomain: "sheep-1b6a7.firebaseapp.com", databaseURL: "https://sheep-1b6a7-default-rtdb.firebaseio.com", projectId: "sheep-1b6a7", storageBucket: "sheep-1b6a7.firebasestorage.app", messagingSenderId: "243565434909", appId: "1:243565434909:web:25312f89033e3fd0d54ef4" };

// --- FIREBASE INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// --- STATE VARIABLES ---
let allRecords = [];
let soldRecords = [];
let archivedRecords = [];
let editSheepModal, saleSheepModal, treatmentLogModal, weightEntryModal, batchTreatmentModal, editSoldSheepModal;
let weightChart, profileWeightChart;
let currentWeeklyFilter = 'all';
let currentScheduleFilter = 'all';
let treatmentLogListener = null; // To manage the live listener for the treatment modal

// --- DOM ELEMENT SELECTORS ---
const mainApp = document.getElementById('mainApp');
const authSection = document.getElementById('authSection');

// --- CORE APPLICATION LOGIC ---

/**
 * Main entry point. Sets up auth listener and initializes the app
 * once the DOM is fully loaded.
 */
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, user => {
        if (user) {
            mainApp.style.display = 'block';
            authSection.style.display = 'none';
            initializeUI();
        } else {
            mainApp.style.display = 'none';
            authSection.style.display = 'block';
        }
    });

    // Add login form listener here so it's always available
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
});

/**
 * Formats a date string (YYYY-MM-DD) into DD/MM/YY.
 * @param {string} dateString - The date string to format.
 * @returns {string} The formatted date or the original string if invalid.
 */
function formatDate(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString.split('T')[0] + 'T00:00:00');
        if (isNaN(date.getTime())) return dateString;
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = String(date.getFullYear()).slice(-2);
        return `${day}/${month}/${year}`;
    } catch (e) {
        return dateString;
    }
}

/**
 * Safely updates the content of a DOM element.
 * Logs an error to the console if the element is not found, preventing script crashes.
 * @param {string} id - The ID of the HTML element.
 * @param {string} content - The text or HTML content to set.
 * @param {boolean} [isHtml=false] - Set to true if the content is HTML.
 */
function updateElement(id, content, isHtml = false) {
    const el = document.getElementById(id);
    if (el) {
        el[isHtml ? 'innerHTML' : 'textContent'] = content;
    } else {
        console.error(`UI Error: HTML element with ID '${id}' was not found in the document. Cannot update its content.`);
    }
}

/**
 * Handles user login.
 * @param {Event} e - The form submit event.
 */
function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    signInWithEmailAndPassword(auth, email, password).catch(err => {
        document.getElementById('authError').textContent = err.message;
    });
}

/**
 * Shows a specific content section and hides others.
 * @param {string} sectionName - The name of the section to show.
 */
function showSection(sectionName) {
    ['home', 'records', 'corentin', 'overdue', 'treatment', 'pregnant', 'saled', 'archived', 'schedule', 'weekly', 'weight', 'profile', 'growth'].forEach(id => {
        document.getElementById(id + 'Section').classList.add('hidden');
    });
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));

    document.getElementById(sectionName + 'Section').classList.remove('hidden');
    document.querySelector(`.nav-link[data-section="${sectionName}"]`).classList.add('active');

    const sidebar = document.querySelector('.dashboard-sidebar');
    if (sidebar.classList.contains('visible')) {
        sidebar.classList.remove('visible');
    }
}

// --- DATA FETCHING ---

/**
 * Determines the follow-up status of a record based on its latest treatment.
 * @param {object} record - The sheep record.
 * @returns {string} 'overdue', 'upcoming', or 'none'.
 */
function getFollowUpStatus(record) {
    // Ensure treatments is a non-null object before processing to prevent errors on malformed data.
    if (!record.treatments || typeof record.treatments !== 'object') return 'none';

    const treatmentsWithFollowUp = Object.values(record.treatments)
        .filter(t => t.followUpDate)
        .sort((a, b) => new Date(b.followUpDate) - new Date(a.followUpDate));

    if (treatmentsWithFollowUp.length === 0) return 'none';

    const latestFollowUpDateStr = treatmentsWithFollowUp[0].followUpDate;
    // Use UTC for consistent date comparison
    const parts = latestFollowUpDateStr.split('-').map(p => parseInt(p, 10));
    if (parts.length !== 3) return 'none';
    const followUpDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

    const today = new Date();
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    if (isNaN(followUpDate.getTime())) return 'none';

    if (followUpDate < todayUTC) {
        return 'overdue';
    } else { // Includes today and future dates
        return 'upcoming';
    }
}

function fetchAllRecords() {
    const recordsRef = ref(db, "sheepHealthRecords");
    onValue(recordsRef, (snapshot) => {
        let healthyHtml = '';
        let corentinRecords = [];
        let overdueRecords = [];
        let underTreatmentRecords = [];
        let pregnantRecords = [];
        allRecords = [];

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const record = { id: child.key, ...child.val() };
                allRecords.push(record);
                const status = record.healthStatus;

                if (status === 'Healthy' || status === 'Recovering') {
                    healthyHtml += renderHealthyRow(record);
                } else if (status === 'Corentin' || status === 'Under Treatment') {
                    // Check for overdue status first to pull them into a separate list
                    if (getFollowUpStatus(record) === 'overdue') {
                        overdueRecords.push(record);
                    } else {
                        // If not overdue, sort into their respective lists
                        if (status === 'Corentin') {
                            corentinRecords.push(record);
                        } else { // Under Treatment
                            underTreatmentRecords.push(record);
                        }
                    }
                } else if (status === 'Pregnant') {
                    pregnantRecords.push(record);
                }
            });
        }

        const overdueHtml = overdueRecords.map(renderTreatmentRow).join('');
        const corentinHtml = corentinRecords.map(renderTreatmentRow).join('');
        const treatmentHtml = underTreatmentRecords.map(renderTreatmentRow).join('');
        const pregnantHtml = pregnantRecords.map(renderPregnantRow).join('');

        document.getElementById('healthyRecordsTableBody').innerHTML = healthyHtml || `<tr><td colspan="7" class="text-center">No healthy records.</td></tr>`;
        document.getElementById('overdueRecordsTableBody').innerHTML = overdueHtml || `<tr><td colspan="6" class="text-center">No overdue records. Great job!</td></tr>`;
        document.getElementById('corentinRecordsTableBody').innerHTML = corentinHtml || `<tr><td colspan="6" class="text-center">No 'Corentin' status records.</td></tr>`;
        document.getElementById('treatmentRecordsTableBody').innerHTML = treatmentHtml || `<tr><td colspan="6" class="text-center">No 'Under Treatment' records.</td></tr>`;
        document.getElementById('pregnantRecordsTableBody').innerHTML = pregnantHtml || `<tr><td colspan="6" class="text-center">No pregnant records.</td></tr>`;

        updateFlockStatus();
        updateGrowthAnalytics();
        updateScheduleView();
        updateWeeklyTrackingView();
        updateWeightTrackingView();
        updateProfileView();
        checkTreatmentFollowUps();
        checkPreventativeCareReminders();
    }, (error) => {
        console.error("Fatal Error: Could not fetch main sheep records.", error);
        const errorHtml = (cols) => `<tr><td colspan="${cols}" class="text-center text-danger">Error loading records. Please check your connection and refresh the page.</td></tr>`;

        // Display error message in all dependent tables
        document.getElementById('healthyRecordsTableBody').innerHTML = errorHtml(7);
        document.getElementById('overdueRecordsTableBody').innerHTML = errorHtml(6);
        document.getElementById('corentinRecordsTableBody').innerHTML = errorHtml(6);
        document.getElementById('treatmentRecordsTableBody').innerHTML = errorHtml(6);
        document.getElementById('scheduleTableBody').innerHTML = errorHtml(9);
        document.getElementById('weeklyTableBody').innerHTML = errorHtml(5);

        // Reset analytics to a zero/error state
        ['totalCount', 'healthyCount', 'sickCount', 'treatmentCount'].forEach(id => document.getElementById(id).textContent = '0');
    });
}

function fetchSoldRecords() {
    const recordsRef = ref(db, "sheepSaledRecords");
    const soldQuery = query(recordsRef, orderByChild("saleDate"));
    onValue(soldQuery, snapshot => {
        const tableBody = document.getElementById('sheepSaledTableBody');
        soldRecords = [];
        let rowsHtml = '';
        const monthlyTotals = {};

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const record = { id: child.key, ...child.val() };
                soldRecords.push(record);

                // Calculate monthly totals
                if (record.saleDate && record.salePrice) {
                    const saleDate = new Date(record.saleDate + 'T00:00:00');
                    if (!isNaN(saleDate.getTime())) {
                        const monthKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`; // e.g., "2025-08"
                        
                        if (!monthlyTotals[monthKey]) {
                            monthlyTotals[monthKey] = { sales: 0, profit: 0 };
                        }

                        const salePrice = parseFloat(record.salePrice) || 0;
                        const buyingPrice = parseFloat(record.buyingPrice) || 0;
                        const profit = salePrice - buyingPrice;

                        monthlyTotals[monthKey].sales += salePrice;
                        monthlyTotals[monthKey].profit += profit;
                    }
                }
            });
            soldRecords.reverse(); // Show newest first
            rowsHtml = soldRecords.map(renderSoldRow).join('');
        }
        tableBody.innerHTML = rowsHtml || `<tr><td colspan="5" class="text-center p-4 text-muted">No sold records found.</td></tr>`;
        
        renderMonthlySalesSummary(monthlyTotals);

        updateProfileView();
    }, error => {
        console.error("Error fetching sold records:", error);
        document.getElementById('sheepSaledTableBody').innerHTML = `<tr><td colspan="5" class="text-center text-danger p-4">Error loading sold records. Check browser console for details.</td></tr>`;
    });
}

function fetchArchivedRecords() {
    const recordsRef = ref(db, "sheepArchivedRecords");
    const archivedQuery = query(recordsRef, orderByChild("archiveDate"));
    onValue(archivedQuery, snapshot => {
        const tableBody = document.getElementById('archivedRecordsTableBody');
        archivedRecords = [];
        let rowsHtml = '';
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const record = { id: child.key, ...child.val() };
                archivedRecords.push(record);
            });
            archivedRecords.reverse(); // Show newest first
            rowsHtml = archivedRecords.map(renderArchivedRow).join('');
        }
        tableBody.innerHTML = rowsHtml || `<tr><td colspan="6" class="text-center">No archived records.</td></tr>`;
        updateProfileView();
    }, error => {
        console.error("Error fetching archived records:", error);
        document.getElementById('archivedRecordsTableBody').innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error loading archived records. Check browser console for details.</td></tr>`;
    });
}

// --- ROW RENDERING FUNCTIONS ---

/**
 * Generates HTML for the follow-up date cell with color coding and relative time.
 * @param {string} followUpDateStr - The follow-up date in 'YYYY-MM-DD' format.
 * @returns {{html: string, rowClass: string}} An object containing the HTML string and a CSS class for the table row.
 */
function getFollowUpDateDisplay(followUpDateStr) {
    if (!followUpDateStr) {
        return { html: 'N/A', rowClass: '' };
    }

    const formattedFollowUpDate = formatDate(followUpDateStr);
    // Use UTC for consistent date comparison
    const parts = followUpDateStr.split('-').map(p => parseInt(p, 10));
    if (parts.length !== 3 || parts.some(isNaN)) {
        return { html: 'Invalid Date', rowClass: '' };
    }
    const followUpDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

    const today = new Date();
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    if (isNaN(followUpDate.getTime())) {
        return { html: 'Invalid Date', rowClass: '' };
    }

    const dayDiff = Math.ceil((followUpDate.getTime() - todayUTC.getTime()) / (1000 * 3600 * 24));

    if (dayDiff < 0) {
        return { html: `<span class="text-danger fw-bold">${formattedFollowUpDate} (Overdue)</span>`, rowClass: 'table-danger-light' };
    } else if (dayDiff === 0) {
        return { html: `<span class="text-warning fw-bold">${formattedFollowUpDate} (Today)</span>`, rowClass: 'table-warning-light' };
    } else if (dayDiff <= 7) {
        return { html: `<span class="text-info fw-bold">${formattedFollowUpDate} (in ${dayDiff} day${dayDiff > 1 ? 's' : ''})</span>`, rowClass: 'table-info-light' };
    } else {
        return { html: `<span>${formattedFollowUpDate} (in ${dayDiff} day${dayDiff > 1 ? 's' : ''})</span>`, rowClass: '' };
    }
}

function renderSoldRow(record) {
    // Financial Calculations
    const buyingPrice = parseFloat(record.buyingPrice) || 0;
    const salePrice = parseFloat(record.salePrice) || 0;
    const profit = salePrice - buyingPrice;

    let profitClass = 'text-body-secondary';
    let profitSign = '';
    if (profit > 0) {
        profitClass = 'text-success';
        profitSign = '+';
    } else if (profit < 0) {
        profitClass = 'text-danger';
    }

    const notesHtml = record.saleNotes 
        ? `<div class="small text-muted mt-2 fst-italic"><i class="fas fa-comment-dots me-1 text-info"></i>${record.saleNotes}</div>` 
        : '';

    return `
        <tr>
            <td>
                <a href="#" class="fw-bold profile-link" data-sheep-id="${record.id}" title="View full profile for ${record.sheepId}">${record.sheepId}</a>
                <div class="small text-muted">${record.breed || 'N/A'}</div>
            </td>
            <td>
                <div class="d-flex justify-content-between"><span>Sale Price</span><strong>₹${salePrice.toFixed(2)}</strong></div>
                <div class="d-flex justify-content-between small text-muted"><span>Buying Price</span><span>- ₹${buyingPrice.toFixed(2)}</span></div>
                <hr class="my-1">
                <div class="d-flex justify-content-between fw-bold ${profitClass}"><span>Profit/Loss</span><span>${profitSign}₹${profit.toFixed(2)}</span></div>
            </td>
            <td>
                <div><i class="fas fa-calendar-alt fa-fw me-2 text-muted"></i>${formatDate(record.saleDate)}</div>
                <div class="mt-1"><i class="fas fa-user fa-fw me-2 text-muted"></i>${record.saleBuyer || 'N/A'}</div>
                ${notesHtml}
            </td>
            <td><span class="badge fs-6 ${getBootstrapStatusClass(record.healthStatus)}">${record.healthStatus}</span></td>
            <td class="text-center align-middle">
                <button class="btn btn-sm btn-outline-danger js-delete-sold-record" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Permanently Delete Sale Record"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `;
}


function renderMonthlySalesSummary(monthlyTotals) {
    const container = document.getElementById('monthlySalesSummary');
    if (!container) {
        console.error("UI Error: HTML element with ID 'monthlySalesSummary' not found.");
        return;
    }

    if (Object.keys(monthlyTotals).length === 0) {
        container.innerHTML = '<p class="text-muted text-center p-3 mb-0">No sales data available.</p>';
        return;
    }

    // Sort months chronologically, newest first, and limit to the last 6 for a clean look
    const sortedMonths = Object.keys(monthlyTotals).sort().reverse().slice(0, 6);

    let listHtml = '<ul class="list-group list-group-flush">';
    sortedMonths.forEach(monthKey => {
        const monthData = monthlyTotals[monthKey];
        const { sales, profit } = monthData;
        const [year, month] = monthKey.split('-');
        const monthName = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' });

        const profitClass = profit >= 0 ? 'text-success' : 'text-danger';
        const profitSign = profit >= 0 ? '+' : '';

        listHtml += `
            <li class="list-group-item">
                <div class="d-flex justify-content-between align-items-center">
                    <span>${monthName} ${year}</span>
                    <strong class="text-dark-emphasis">₹${sales.toFixed(2)}</strong>
                </div>
                <div class="d-flex justify-content-between align-items-center small mt-1">
                    <span class="text-muted">Profit/Loss</span>
                    <strong class="${profitClass}">${profitSign}₹${profit.toFixed(2)}</strong>
                </div>
            </li>
        `;
    });
    listHtml += '</ul>';

    container.innerHTML = listHtml;
}

function renderArchivedRow(record) {
    return `<tr>
        <td><strong>${record.sheepId}</strong></td>
        <td><span class="${getStatusClass(record.healthStatus)}">${record.healthStatus}</span></td>
        <td>${formatDate(record.archiveDate)}</td>
        <td>${formatDate(record.dateRecorded)}</td>
        <td>${record.notes || ''}</td>
        <td><button class="btn btn-sm btn-outline-danger js-delete-archived-record" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Permanently Delete"><i class="fas fa-trash"></i></button></td>
    </tr>`;
}

function renderHealthyRow(record) {
    return `<tr>
        <td><strong>${record.sheepId}</strong></td>
        <td>${record.gender || 'N/A'}</td>
        <td>${record.breed || 'N/A'}</td>
        <td><span class="${getStatusClass(record.healthStatus)}">${record.healthStatus}</span></td>
        <td>${formatDate(record.dateRecorded)}</td>
        <td>${record.weight || 'N/A'}</td>
        <td>${record.temperature || 'N/A'}</td>
        <td>${record.buyingPrice ? `₹${parseFloat(record.buyingPrice).toFixed(2)}` : 'N/A'}</td>
        <td><strong>${record.notes || ''}</strong></td>
        <td>
            <button class="btn btn-sm btn-info js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}"><i class="fas fa-notes-medical"></i> Manage</button>
            <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}"><i class="fas fa-edit"></i></button>
            <button class="btn btn-sm btn-outline-success js-sale-record" data-record-id="${record.id}"><i class="fas fa-dollar-sign"></i> Sale</button>
            <button class="btn btn-sm btn-outline-danger js-delete-record" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Permanently Delete"><i class="fas fa-trash"></i></button>
            <button class="btn btn-sm btn-outline-secondary js-archive-record" data-record-id="${record.id}" title="Mark as Deceased/Archive"><i class="fas fa-archive"></i></button>
        </td>
    </tr>`;
}

function renderTreatmentRow(record) {
    let lastUpdate = 'N/A';
    let followUpDateHtml = 'N/A';
    let rowClass = ''; // For highlighting the entire row
    let isOverdue = false;

    if (record.treatments) {
        const treatments = Object.values(record.treatments).sort((a, b) => new Date(b.treatmentDate) - new Date(a.treatmentDate));
        if (treatments.length > 0) {
            const latestTreatment = treatments[0];
            lastUpdate = formatDate(latestTreatment.treatmentDate);

            if (latestTreatment.followUpDate) {
                const display = getFollowUpDateDisplay(latestTreatment.followUpDate);
                followUpDateHtml = display.html;
                rowClass = display.rowClass;
                isOverdue = (rowClass === 'table-danger-light');
            }
        }
    }

    const actionButtons = isOverdue
        ? `<button class="btn btn-sm btn-warning js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}"><i class="fas fa-notes-medical"></i> Log Follow-up</button>
           <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}"><i class="fas fa-edit"></i></button>
           <button class="btn btn-sm btn-outline-danger js-delete-record" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Permanently Delete"><i class="fas fa-trash"></i></button>`
        : `<button class="btn btn-sm btn-info js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}"><i class="fas fa-notes-medical"></i> Manage</button>
           <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}"><i class="fas fa-edit"></i></button>
           <button class="btn btn-sm btn-outline-success js-sale-record" data-record-id="${record.id}"><i class="fas fa-dollar-sign"></i> Sale</button>
           <button class="btn btn-sm btn-outline-danger js-delete-record" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Permanently Delete"><i class="fas fa-trash"></i></button>
           <button class="btn btn-sm btn-outline-secondary js-archive-record" data-record-id="${record.id}" title="Mark as Deceased/Archive"><i class="fas fa-archive"></i></button>`;

    return `<tr class="${rowClass}">
        <td><strong>${record.sheepId}</strong></td>
        <td><span class="${getStatusClass(record.healthStatus)}">${record.healthStatus}</span></td>
        <td>${formatDate(record.dateRecorded)}</td>
        <td>${lastUpdate}</td>
        <td>${followUpDateHtml}</td>
        <td>${actionButtons}</td>
    </tr>`;
}

function renderPregnantRow(record) {
    let lastUpdate = 'N/A';
    let followUpDateHtml = 'N/A';
    let rowClass = '';

    if (record.treatments) {
        const treatments = Object.values(record.treatments).sort((a, b) => new Date(b.treatmentDate) - new Date(a.treatmentDate));
        if (treatments.length > 0) {
            const latestTreatment = treatments[0];
            lastUpdate = formatDate(latestTreatment.treatmentDate);

            if (latestTreatment.followUpDate) {
                const display = getFollowUpDateDisplay(latestTreatment.followUpDate);
                followUpDateHtml = display.html;
                rowClass = display.rowClass;
            }
        }
    }

    return `<tr class="${rowClass}">
        <td><strong>${record.sheepId}</strong></td>
        <td><span class="${getStatusClass(record.healthStatus)}">${record.healthStatus}</span></td>
        <td>${formatDate(record.dateRecorded)}</td>
        <td>${lastUpdate}</td>
        <td>${followUpDateHtml}</td>
        <td>
            <button class="btn btn-sm btn-info js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}"><i class="fas fa-notes-medical"></i> Manage</button>
            <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}"><i class="fas fa-edit"></i></button>
        </td>
    </tr>`;
}

function renderWeeklyRow(record) {
    const lastActivityDateStr = formatDate(record.lastActivityDate.toISOString().split('T')[0]);
    const weeklyStatusBadge = record.isChecked ? '<span class="badge bg-success">Checked</span>' : '<span class="badge bg-warning text-dark">Needs Check</span>';
    return `<tr>
        <td><strong>${record.sheepId}</strong></td>
        <td><span class="${getStatusClass(record.healthStatus)}">${record.healthStatus}</span></td>
        <td>${lastActivityDateStr}</td>
        <td>${weeklyStatusBadge}</td>
        <td>
            <button class="btn btn-sm btn-info js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Log New Treatment"><i class="fas fa-notes-medical"></i> Manage</button>
            <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}" title="Edit Record"><i class="fas fa-edit"></i></button>
        </td>
    </tr>`;
}

/**
 * Renders a single row for the redesigned Preventative Care Schedule table.
 * @param {object} record - The sheep record object.
 * @returns {string} The HTML string for the table row (<tr>).
 */
function renderScheduleRow(record) {
    const dewormingStatus = getScheduleStatus(record.lastDewormingDate, 30, null);
    const vaccinationStatus = getScheduleStatus(record.lastVaccinationDate, 365, record.manualVaccinationDueDate);

    const rowClass = (dewormingStatus.isOverdue || vaccinationStatus.isOverdue) ? 'table-danger-light' : '';

    const renderCareCell = (status, notes, lastDate) => {
        const notesHtml = notes
            ? `<div class="small text-body-secondary mt-2">
                 <i class="fas fa-comment-alt me-1 text-info"></i><em class="fst-italic">${notes}</em>
               </div>`
            : '';

        // A more elegant display for when no data is available
        if (status.status === 'Not Set') {
            return `
                <td>
                    <div>${renderScheduleStatusBadge(status)}</div>
                    <div class="text-body-secondary mt-1 fst-italic">
                        No care schedule has been recorded for this item.
                    </div>
                    ${notesHtml}
                </td>
            `;
        }
        
        const lastDateHtml = lastDate ? formatDate(lastDate) : 'N/A';

        let dueTextHtml;
        const match = status.fullText.match(/(.*)\s\((.*)\)/);
        if (match) {
            // If text has a date in parentheses, split and style them differently
            dueTextHtml = `${match[1]} <span class="text-body-secondary small">(${match[2]})</span>`;
        } else {
            dueTextHtml = status.fullText;
        }

        return `
            <td>
                <div>${renderScheduleStatusBadge(status)}</div>
                <div class="mt-1">
                    <div class="text-dark-emphasis">${dueTextHtml}</div>
                    <div class="small text-body-secondary">Last Given: <strong>${lastDateHtml}</strong></div>
                </div>
                ${notesHtml}
            </td>
        `;
    };

    return `
        <tr class="${rowClass}" data-sheep-id="${record.id}">
            <td class="text-center">
                <input class="form-check-input schedule-checkbox" type="checkbox" value="${record.id}" data-id="${record.id}">
            </td>
            <td>
                <a href="#" class="fw-bold profile-link" data-sheep-id="${record.id}" title="View full profile for ${record.sheepId}">${record.sheepId}</a>
                <div class="small text-muted">${record.breed || 'N/A'}</div>
            </td>
            
            ${renderCareCell(dewormingStatus, record.lastDewormingNotes, record.lastDewormingDate)}
            ${renderCareCell(vaccinationStatus, record.lastVaccinationNotes, record.lastVaccinationDate)}

            <td class="text-center">
                <div class="btn-group-vertical btn-group-sm" role="group">
                    <button type="button" class="btn btn-outline-primary js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Log New Care">
                        <i class="fas fa-syringe fa-fw me-1"></i> Log Care
                    </button>
                    <button type="button" class="btn btn-outline-secondary js-edit-record" data-record-id="${record.id}" title="Edit Sheep Details">
                        <i class="fas fa-edit fa-fw me-1"></i> Edit
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// --- NOTIFICATION HANDLING ---

function checkTreatmentFollowUps() {
    const notifications = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    allRecords.forEach(record => {
        if (record.treatments) {
            const treatmentsWithFollowUp = Object.values(record.treatments).filter(t => t.followUpDate);
            if (treatmentsWithFollowUp.length > 0) {
                treatmentsWithFollowUp.sort((a, b) => new Date(b.followUpDate) - new Date(a.followUpDate));
                const latestFollowUp = treatmentsWithFollowUp[0];
                const followUpDate = new Date(latestFollowUp.followUpDate + 'T00:00:00');

                if (!isNaN(followUpDate.getTime())) {
                    const dayDiff = Math.ceil((followUpDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
                    let status = '', message = '';
                    if (dayDiff < 0) {
                        status = 'Overdue';
                        message = `Treatment follow-up was due ${-dayDiff} day(s) ago.`;
                    } else if (dayDiff === 0) {
                        status = 'Due Today';
                        message = 'Treatment follow-up is due today.';
                    } else if (dayDiff <= 7) {
                        status = 'Upcoming';
                        message = `Treatment follow-up due in ${dayDiff} day(s).`;
                    }
                    if (status) {
                        notifications.push({ sheepId: record.sheepId, recordId: record.id, message, status });
                    }
                }
            }
        }
    });

    const listEl = document.getElementById('notification-list');
    const badgeEl = document.getElementById('notification-badge');
    renderNotificationList(notifications, listEl, badgeEl, 'No pending treatment follow-ups.');
}

function checkPreventativeCareReminders() {
    const reminders = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const getDayDiffFromLastDate = (lastDateStr, daysUntilDue) => {
        if (!lastDateStr) return null;
        const lastDate = new Date(lastDateStr + 'T00:00:00');
        const dueDate = new Date(lastDate.getTime());
        dueDate.setDate(dueDate.getDate() + daysUntilDue);
        if (isNaN(dueDate.getTime())) return null;
        const timeDiff = dueDate.getTime() - today.getTime();
        return Math.ceil(timeDiff / (1000 * 3600 * 24));
    };

    allRecords.forEach(record => {
        const dewormingDayDiff = getDayDiffFromLastDate(record.lastDewormingDate, 30);
        if (dewormingDayDiff !== null && dewormingDayDiff <= 24) {
            let status = '', message = '';
            if (dewormingDayDiff < 0) { message = `Deworming is overdue by ${-dewormingDayDiff} day(s).`; }
            else if (dewormingDayDiff === 0) { message = 'Deworming is due today.'; }
            else { message = `Deworming due in ${dewormingDayDiff} day(s).`; }

            if (dewormingDayDiff <= 5) { status = 'Overdue'; }
            else { status = 'Upcoming'; }
            reminders.push({ sheepId: record.sheepId, recordId: record.id, message, status });
        }

        let vaxDayDiff;
        if (record.manualVaccinationDueDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dueDate = new Date(record.manualVaccinationDueDate + 'T00:00:00');
            if (!isNaN(dueDate.getTime())) {
                vaxDayDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
            } else {
                vaxDayDiff = null;
            }
        } else {
            vaxDayDiff = getDayDiffFromLastDate(record.lastVaccinationDate, 365);
        }
        if (vaxDayDiff !== null && vaxDayDiff <= 24) {
            let status = '', message = '';
            if (vaxDayDiff < 0) { message = `Vaccination is overdue by ${-vaxDayDiff} day(s).`; }
            else if (vaxDayDiff === 0) { message = 'Vaccination is due today.'; }
            else { message = `Vaccination due in ${vaxDayDiff} day(s).`; }

            if (vaxDayDiff <= 5) { status = 'Overdue'; }
            else { status = 'Upcoming'; }
            reminders.push({ sheepId: record.sheepId, recordId: record.id, message, status });
        }
    });

    const listEl = document.getElementById('schedule-notification-list');
    const badgeEl = document.getElementById('schedule-notification-badge');
    renderNotificationList(reminders, listEl, badgeEl, 'No upcoming preventative care.');
}

function renderNotificationList(notifications, listEl, badgeEl, emptyText) {
    listEl.innerHTML = '';

    if (notifications.length === 0) {
        badgeEl.style.display = 'none';
        listEl.innerHTML = `<li><a class="dropdown-item text-muted" href="#">${emptyText}</a></li>`;
        return;
    }

    notifications.sort((a, b) => {
        const statusOrder = { 'Overdue': 1, 'Due Today': 2, 'Upcoming': 3 };
        return statusOrder[a.status] - statusOrder[b.status];
    });

    badgeEl.textContent = notifications.length;
    badgeEl.style.display = 'block';

    notifications.forEach(n => {
        let iconClass = '';
        if (n.status === 'Overdue') iconClass = 'fas fa-exclamation-circle text-danger';
        else if (n.status === 'Due Today') iconClass = 'fas fa-calendar-day text-warning';
        else if (n.status === 'Upcoming') iconClass = 'fas fa-calendar-alt text-info';

        listEl.innerHTML += `<li><a href="#" class="dropdown-item notification-item" data-record-id="${n.recordId}"><div class="icon"><i class="${iconClass}"></i></div><div class="content"><strong>Sheep ID: ${n.sheepId}</strong><div class="small text-muted">${n.message}</div></div></a></li>`;
    });
}

function viewRecordFromNotification(recordId) {
    const record = allRecords.find(r => r.id === recordId);
    if (!record) {
        alert('Could not find the record. It may have been moved or deleted.');
        return;
    }
    openTreatmentLog(record.id, record.sheepId);
}

// --- WEEKLY TRACKING SECTION ---

function updateWeeklyTrackingView(filter = currentWeeklyFilter) {
    currentWeeklyFilter = filter;

    document.querySelectorAll('#weeklyFilterButtons button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    const tableBody = document.getElementById('weeklyTableBody');
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    let recordsWithStatus = allRecords.map(record => {
        let lastActivityDate = new Date(record.dateRecorded + 'T00:00:00');

        if (record.treatments) {
            Object.values(record.treatments).forEach(treatment => {
                const treatmentDate = new Date(treatment.treatmentDate + 'T00:00:00');
                if (!isNaN(treatmentDate.getTime()) && treatmentDate > lastActivityDate) {
                    lastActivityDate = treatmentDate;
                }
            });
        }

        const isChecked = lastActivityDate >= sevenDaysAgo;
        return { ...record, lastActivityDate, isChecked };
    });

    let filteredRecords = recordsWithStatus.filter(r => {
        if (filter === 'all') return true;
        if (filter === 'checked') return r.isChecked;
        if (filter === 'needs_check') return !r.isChecked;
        return false;
    });

    filteredRecords.sort((a, b) => a.sheepId.localeCompare(b.sheepId, undefined, { numeric: true }));

    tableBody.innerHTML = filteredRecords.length > 0 ? filteredRecords.map(r => renderWeeklyRow(r)).join('') : `<tr><td colspan="5" class="text-center">No sheep match the filter criteria.</td></tr>`;
}

// --- HEALTH SCHEDULE SECTION ---

function updateScheduleView(filter = currentScheduleFilter) {
    currentScheduleFilter = filter;

    document.querySelectorAll('#scheduleFilterButtons button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    const tableBody = document.getElementById('scheduleTableBody');
    const sortedRecords = [...allRecords].sort((a, b) => a.sheepId.localeCompare(b.sheepId, undefined, { numeric: true }));

    let recordsToDisplay = sortedRecords.filter(record => {
        if (filter === 'all') return true;

        const dewormStatus = getScheduleStatus(record.lastDewormingDate, 30, null);
        const vaxStatus = getScheduleStatus(record.lastVaccinationDate, 365, record.manualVaccinationDueDate);

        if (filter === 'overdue') {
            return dewormStatus.isOverdue || vaxStatus.isOverdue;
        }
        if (filter === 'upcoming') {
            return (dewormStatus.isUpcoming && !dewormStatus.isOverdue) || (vaxStatus.isUpcoming && !vaxStatus.isOverdue);
        }
        return false;
    });

    if (recordsToDisplay.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-muted">No sheep match the filter criteria.</td></tr>`;
    } else {
        tableBody.innerHTML = recordsToDisplay.map(renderScheduleRow).join('');
    }
    updateBatchLogUI();
}

/**
 * HELPER FUNCTION: Determines the status for a scheduled date. Returns a pure data object.
 * @param {string | null} lastDateString - The date of the last treatment.
 * @param {number} daysUntilDue - The number of days in the cycle.
 * @param {string | null} manualDueDateString - An override for the due date.
 * @returns {{status: string, fullText: string, isOverdue: boolean, isUpcoming: boolean, dueDate: Date | null}} An object with status details.
 */
function getScheduleStatus(lastDateString, daysUntilDue, manualDueDateString) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dueDate;
    if (manualDueDateString) {
        dueDate = new Date(manualDueDateString + 'T00:00:00');
    } else if (lastDateString) {
        const lastDate = new Date(lastDateString + 'T00:00:00');
        dueDate = new Date(lastDate.getTime());
        dueDate.setDate(dueDate.getDate() + daysUntilDue);
    } else {
        return { status: 'Not Set', fullText: 'No date recorded', isOverdue: false, isUpcoming: false, dueDate: null };
    }

    if (isNaN(dueDate.getTime())) {
        return { status: 'Invalid Date', fullText: 'The date for this record is invalid.', isOverdue: false, isUpcoming: false, dueDate: null };
    }

    const timeDiff = dueDate.getTime() - today.getTime();
    const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
    const formattedDueDate = formatDate(dueDate.toISOString().split('T')[0]);

    if (dayDiff < 0) {
        return { status: 'Overdue', fullText: `Was due on ${formattedDueDate}`, isOverdue: true, isUpcoming: false, dueDate };
    } else if (dayDiff === 0) {
        return { status: 'Upcoming', fullText: `Due today (${formattedDueDate})`, isOverdue: false, isUpcoming: true, dueDate };
    } else if (dayDiff <= 24) {
        const dueText = `Due in ${dayDiff} day(s)`;
        return { status: 'Upcoming', fullText: `${dueText} (${formattedDueDate})`, isOverdue: false, isUpcoming: true, dueDate };
    } else {
        return { status: 'Up-to-date', fullText: `Due on ${formattedDueDate}`, isOverdue: false, isUpcoming: false, dueDate };
    }
}

/**
 * Renders a Bootstrap badge based on a status object from getScheduleStatus.
 * @param {object} status - The status object.
 * @param {string} lastDate - The last date the care was given, for the tooltip.
 * @returns {string} HTML string for the badge.
 */
function renderScheduleStatusBadge(status, lastDate = null) {
    let className = 'secondary';
    switch (status.status) {
        case 'Overdue':    className = 'danger'; break;
        case 'Upcoming':   className = 'warning text-dark'; break;
        case 'Up-to-date': className = 'success'; break;
        case 'Invalid Date': className = 'dark'; break;
    }

    if (lastDate) {
        // Existing behavior for other parts of the app like the profile page
        const tooltipContent = `Last Given: ${lastDate ? formatDate(lastDate) : 'N/A'}\n${status.fullText}`;
        return `<span class="badge bg-${className}" data-bs-toggle="tooltip" title="${tooltipContent}">${status.status}</span>`;
    } else {
        // New, cleaner look for the main schedule table
        return `<span class="badge fs-6 bg-${className}">${status.status}</span>`;
    }
}

function updateBatchLogUI() {
    const selected = document.querySelectorAll('#scheduleTableBody .sheep-select-checkbox:checked');
    const btn = document.getElementById('batchLogBtn');
    btn.style.display = selected.length > 0 ? 'inline-block' : 'none';
    
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
}

function openBatchLogModal() {
    const selectedCheckboxes = document.querySelectorAll('#scheduleTableBody .sheep-select-checkbox:checked');
    const count = selectedCheckboxes.length;
    if (count === 0) return alert('Please select at least one sheep.');

    document.getElementById('batchCount').textContent = count;
    document.getElementById('batchTreatmentForm').reset();
    document.getElementById('batchTreatmentDate').valueAsDate = new Date();
    batchTreatmentModal.show();
}

// --- WEIGHT TRACKING SECTION ---

function updateWeightTrackingView() {
    const selector = document.getElementById('weightSheepSelector');
    const currentSelection = selector.value;
    selector.innerHTML = '<option selected disabled value="">Select a sheep</option>';

    const sortedRecords = [...allRecords].sort((a, b) => a.sheepId.localeCompare(b.sheepId, undefined, { numeric: true }));

    sortedRecords.forEach(record => {
        const allWeightPoints = gatherAllWeightData(record);
        const latestWeight = allWeightPoints.length > 0 ? allWeightPoints[allWeightPoints.length - 1].weight : null;

        const option = document.createElement('option');
        option.value = record.id;
        let displayText = record.sheepId;
        if (latestWeight !== null) {
            displayText += ` (${latestWeight.toFixed(1)} kg)`;
        }
        option.textContent = displayText;
        selector.appendChild(option);
    });

    selector.value = currentSelection;

    if (currentSelection) {
        renderWeightChartForSheep(currentSelection);
    } else {
        document.getElementById('weightDisplayArea').style.display = 'none';
        document.getElementById('noWeightData').style.display = 'block';
        document.getElementById('addWeightBtn').style.display = 'none';
        document.getElementById('latestWeightDisplay').style.display = 'none !important';
        document.getElementById('noWeightData').textContent = 'Select a sheep to view its chart.';
        if (weightChart) {
            weightChart.destroy();
            weightChart = null;
        }
    }
}

function renderWeightChartForSheep(recordId) {
    const record = allRecords.find(r => r.id === recordId);
    const displayArea = document.getElementById('weightDisplayArea');
    const noDataMessage = document.getElementById('noWeightData');
    const addBtn = document.getElementById('addWeightBtn');
    const latestWeightDisplay = document.getElementById('latestWeightDisplay');
    const latestWeightValue = document.getElementById('latestWeightValue');

    if (!record) {
        noDataMessage.textContent = `Could not find record. It may have been moved or deleted.`;
        noDataMessage.style.display = 'block';
        displayArea.style.display = 'none';
        addBtn.style.display = 'none';
        latestWeightDisplay.style.display = 'none !important';
        if (weightChart) { weightChart.destroy(); weightChart = null; }
        return;
    }

    const startDate = new Date(record.dateRecorded + 'T00:00:00');
    if (isNaN(startDate.getTime())) {
        noDataMessage.textContent = `The start date for Sheep ID ${record.sheepId} is invalid.`;
        noDataMessage.style.display = 'block';
        displayArea.style.display = 'none';
        addBtn.style.display = 'none';
        latestWeightDisplay.style.display = 'none !important';
        if (weightChart) { weightChart.destroy(); weightChart = null; }
        return;
    }

    addBtn.style.display = 'inline-block';

    const allWeightPoints = gatherAllWeightData(record);
    renderWeightDataTable(allWeightPoints, recordId);

    if (allWeightPoints.length > 0) {
        const latestWeight = allWeightPoints[allWeightPoints.length - 1].weight;
        latestWeightValue.textContent = `${latestWeight.toFixed(1)} kg`;
        latestWeightDisplay.style.display = 'inline-block !important';
    } else {
        latestWeightDisplay.style.display = 'none !important';
    }

    const chartPoints = allWeightPoints
        .map(dp => ({ x: (dp.date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 7), y: dp.weight }));

    if (chartPoints.length < 1) {
        noDataMessage.textContent = `No weight data found for Sheep ID ${record.sheepId}. Use the 'Add Weight Entry' button to start tracking.`;
        noDataMessage.style.display = 'block';
        displayArea.style.display = 'none';
        if (weightChart) { weightChart.destroy(); weightChart = null; }
        return;
    }

    noDataMessage.style.display = 'none';
    displayArea.style.display = 'block';

    const ctx = document.getElementById('weightChart').getContext('2d');
    if (weightChart) { weightChart.destroy(); }

    calculateAndDisplayWeightStats(allWeightPoints);

    weightChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{ label: `Weight (kg) for ${record.sheepId}`, data: chartPoints, borderColor: '#0d6efd', backgroundColor: 'rgba(13, 110, 253, 0.1)', fill: true, tension: 0.1, pointRadius: 5, pointHoverRadius: 7 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Weeks Since Record Start Date' }, min: 0 },
                y: { title: { display: true, text: 'Weight (kg)' }, beginAtZero: true }
            },
            plugins: { tooltip: { callbacks: {
                title: context => `Week ${context[0].raw.x.toFixed(1)}`,
                label: context => `Weight: ${context.raw.y} kg`
            }}}
        }
    });
}

function gatherAllWeightData(record) {
    let points = [];
    if (record.weight) {
        points.push({ id: 'initial', date: new Date(record.dateRecorded + 'T00:00:00'), weight: parseFloat(record.weight), source: 'initial' });
    }
    if (record.weights) {
        Object.entries(record.weights).forEach(([key, value]) => {
            if (value.date && value.weight) {
                points.push({ id: key, date: new Date(value.date + 'T00:00:00'), weight: parseFloat(value.weight), source: 'log' });
            }
        });
    }
    if (record.treatments) {
        Object.entries(record.treatments).forEach(([key, value]) => {
            if (value.weight && value.treatmentDate) {
                points.push({ id: key, date: new Date(value.treatmentDate + 'T00:00:00'), weight: parseFloat(value.weight), source: 'treatment' });
            }
        });
    }
    return points.filter(p => p.date && !isNaN(p.date.getTime()) && p.weight && !isNaN(p.weight)).sort((a, b) => a.date - b.date);
}

function renderWeightDataTable(weightPoints, recordId, containerId = 'weightTableContainer') {
    const container = document.getElementById(containerId);
    if (weightPoints.length === 0) {
        container.innerHTML = '<p>No weight history recorded.</p>';
        return;
    }
    let tableHtml = `<table class="table table-sm table-striped"><thead><tr><th>Date</th><th>Weight (kg)</th><th>Source</th><th>Actions</th></tr></thead><tbody>`;
    weightPoints.forEach(p => {
        let sourceText = '';
        let actions = '';
        switch (p.source) {
            case 'initial':
                sourceText = '<span class="badge bg-primary">Initial Record</span>';
                actions = `<button class="btn btn-sm btn-outline-primary js-edit-weight" data-record-id="${recordId}" data-entry-id="${p.id}" data-source="initial" title="Edit Initial Weight"><i class="fas fa-edit"></i></button>`;
                break;
            case 'log':
                sourceText = '<span class="badge bg-info">Logged Entry</span>';
                actions = `<button class="btn btn-sm btn-outline-primary js-edit-weight" data-record-id="${recordId}" data-entry-id="${p.id}" data-source="log" title="Edit Entry"><i class="fas fa-edit"></i></button> <button class="btn btn-sm btn-outline-danger js-delete-weight" data-record-id="${recordId}" data-entry-id="${p.id}" data-source="log" title="Delete Entry"><i class="fas fa-trash"></i></button>`;
                break;
            case 'treatment':
                sourceText = '<span class="badge bg-secondary">From Treatment Log</span>';
                actions = `<button class="btn btn-sm btn-outline-danger js-delete-weight" data-record-id="${recordId}" data-entry-id="${p.id}" data-source="treatment" title="This is legacy data. Deleting it will remove the weight from the associated treatment log."><i class="fas fa-trash"></i></button>`;
                break;
        }
        tableHtml += `<tr><td>${formatDate(p.date.toISOString().split('T')[0])}</td><td>${p.weight.toFixed(1)}</td><td>${sourceText}</td><td>${actions}</td></tr>`;
    });
    tableHtml += `</tbody></table>`;
    container.innerHTML = tableHtml;
}

function calculateAndDisplayWeightStats(allWeightPoints, containerId = 'weightStatsBody') {
    const container = document.getElementById(containerId);
    if (allWeightPoints.length < 2) {
        container.innerHTML = '<h5 class="card-title">Weight Statistics</h5><p class="card-text text-muted">Need at least two weight points to calculate statistics.</p>';
        return;
    }

    const firstPoint = allWeightPoints[0];
    const lastPoint = allWeightPoints[allWeightPoints.length - 1];

    const weightGain = lastPoint.weight - firstPoint.weight;
    const timeDiffDays = (lastPoint.date.getTime() - firstPoint.date.getTime()) / (1000 * 60 * 60 * 24);

    let awg = 0;
    if (timeDiffDays > 0) {
        awg = (weightGain / timeDiffDays) * 7; // in kg/week
    }

    container.innerHTML = `
        <h5 class="card-title mb-3">Weight Statistics</h5>
        <div class="mb-3">
            <p class="mb-0 text-muted">Average Weekly Gain</p>
            <h3 class="text-success">${awg.toFixed(2)} kg/week</h3>
        </div>
        <div class="mb-3">
            <p class="mb-0 text-muted">Net Weight Gain</p>
            <h4>${weightGain.toFixed(1)} kg</h4>
            <small>(${timeDiffDays.toFixed(0)} days)</small>
        </div>
         <div class="row">
            <div class="col-6 border-end"><p class="mb-0 text-muted">Start Weight</p><h5>${firstPoint.weight.toFixed(1)} kg</h5></div>
            <div class="col-6"><p class="mb-0 text-muted">Latest Weight</p><h5>${lastPoint.weight.toFixed(1)} kg</h5></div>
        </div>
    `;
}

function updateFlockStatus() {
    const total = allRecords.length;
    const healthy = allRecords.filter(r => r.healthStatus === 'Healthy' || r.healthStatus === 'Recovering').length;
    const corentin = allRecords.filter(r => r.healthStatus === 'Corentin').length;
    const treatment = allRecords.filter(r => r.healthStatus === 'Under Treatment').length;
    const pregnant = allRecords.filter(r => r.healthStatus === 'Pregnant').length;
    const maleCount = allRecords.filter(r => r.gender === 'Male').length;
    const femaleCount = allRecords.filter(r => r.gender === 'Female').length;

    updateElement('totalCount', total);
    updateElement('healthyCount', healthy);
    updateElement('sickCount', corentin);
    updateElement('treatmentCount', treatment);
    updateElement('pregnantCount', pregnant);
    updateElement('maleCount', maleCount);
    updateElement('femaleCount', femaleCount);
}

function calculateAWG(record) {
    const allWeightPoints = gatherAllWeightData(record);
    if (allWeightPoints.length < 2) {
        return null;
    }

    const firstPoint = allWeightPoints[0];
    const lastPoint = allWeightPoints[allWeightPoints.length - 1];

    const weightGain = lastPoint.weight - firstPoint.weight;
    const timeDiffDays = (lastPoint.date.getTime() - firstPoint.date.getTime()) / (1000 * 60 * 60 * 24);

    if (timeDiffDays > 0) {
        return (weightGain / timeDiffDays) * 7; // in kg/week
    }
    return null;
}

function updateGrowthAnalytics() {
    const fastestList = document.getElementById('fastestGrowersList');
    const slowestList = document.getElementById('slowestGrowersList');
    fastestList.innerHTML = '<li class="list-group-item text-muted">Calculating...</li>';
    slowestList.innerHTML = '<li class="list-group-item text-muted">Calculating...</li>';

    const sheepWithAwg = allRecords
        .map(record => ({ sheepId: record.sheepId, awg: calculateAWG(record) }))
        .filter(item => item.awg !== null && !isNaN(item.awg));

    if (sheepWithAwg.length === 0) {
        const noDataHtml = '<li class="list-group-item text-muted">Not enough data for weekly gain calculation.</li>';
        fastestList.innerHTML = noDataHtml;
        slowestList.innerHTML = noDataHtml;
        return;
    }

    const sortedFastest = [...sheepWithAwg].sort((a, b) => b.awg - a.awg);
    fastestList.innerHTML = sortedFastest.map(s => `<li class="list-group-item d-flex justify-content-between align-items-center">${s.sheepId} <span class="badge bg-success rounded-pill">${s.awg.toFixed(2)} kg/week</span></li>`).join('') || '<li class="list-group-item text-muted">No sheep with calculated growth.</li>';

    const sortedSlowest = [...sheepWithAwg].sort((a, b) => a.awg - a.awg);
    slowestList.innerHTML = sortedSlowest.map(s => {
        const badgeClass = s.awg < 0 ? 'bg-danger' : 'bg-warning text-dark';
        return `<li class="list-group-item d-flex justify-content-between align-items-center">${s.sheepId} <span class="badge ${badgeClass} rounded-pill">${s.awg.toFixed(2)} kg/week</span></li>`;
    }).join('') || '<li class="list-group-item text-muted">No sheep with calculated growth.</li>';
}

// --- FORM & MODAL HANDLERS ---

function handleAddRecord(e) {
    e.preventDefault();

    // Helper to safely get value from an element by its ID.
    const getValue = (id, defaultValue = null) => {
        const el = document.getElementById(id);
        if (!el) {
            console.error(`Critical Error: Form element with ID '${id}' is missing from the HTML.`);
            return defaultValue;
        }
        return el.value;
    };

    const newRecord = {
        sheepId: (getValue('sheepId') || '').trim(),
        gender: getValue('gender', 'Female'),
        breed: (getValue('breed') || '').trim() || null,
        buyingPrice: parseFloat(getValue('buyingPrice')) || null,
        healthStatus: getValue('healthStatus', 'Healthy'),
        dateRecorded: getValue('dateRecorded', ''),
        notes: (getValue('notes') || '').trim(),
        weight: getValue('weight') || null,
        temperature: getValue('temperature') || null,
    };
    if (!newRecord.sheepId || !newRecord.dateRecorded) return alert("Sheep ID and Date are required. Could not submit form because a required field element is missing from the HTML.");
    const isDuplicate = allRecords.some(record => record.sheepId.toLowerCase() === newRecord.sheepId.toLowerCase());
    if (isDuplicate) {
        alert(`Error: A sheep with ID "${newRecord.sheepId}" already exists in the active records. Please use a unique ID.`);
        return;
    }
    push(ref(db, 'sheepHealthRecords'), newRecord).then(() => {
        e.target.reset();
        const dateEl = document.getElementById('dateRecorded');
        if (dateEl) dateEl.valueAsDate = new Date();
    });
}

function openEditModal(recordId) {
    const record = allRecords.find(r => r.id === recordId);
    if (!record) return;
    document.getElementById('editRecordId').value = recordId;
    document.getElementById('editSheepId').value = record.sheepId;
    document.getElementById('editGender').value = record.gender || 'Female';
    document.getElementById('editBreed').value = record.breed || '';
    document.getElementById('editBuyingPrice').value = record.buyingPrice || '';
    document.getElementById('editHealthStatus').value = record.healthStatus;
    document.getElementById('editDateRecorded').value = record.dateRecorded;
    document.getElementById('editNotes').value = record.notes || '';
    document.getElementById('editLastDewormingDate').value = record.lastDewormingDate || '';
    document.getElementById('editLastDewormingNotes').value = record.lastDewormingNotes || '';
    document.getElementById('editLastVaccinationDate').value = record.lastVaccinationDate || '';
    document.getElementById('editManualVaccinationDueDate').value = record.manualVaccinationDueDate || '';
    document.getElementById('editLastVaccinationNotes').value = record.lastVaccinationNotes || '';
    editSheepModal.show();
}

function handleUpdateRecord(e) {
    e.preventDefault();
    const recordId = document.getElementById('editRecordId').value;
    const updatedData = {
        sheepId: document.getElementById('editSheepId').value.trim(),
        gender: document.getElementById('editGender').value,
        breed: document.getElementById('editBreed').value.trim() || null,
        buyingPrice: parseFloat(document.getElementById('editBuyingPrice').value) || null,
        healthStatus: document.getElementById('editHealthStatus').value,
        dateRecorded: document.getElementById('editDateRecorded').value,
        notes: document.getElementById('editNotes').value.trim(),
        lastDewormingDate: document.getElementById('editLastDewormingDate').value || null,
        lastDewormingNotes: document.getElementById('editLastDewormingNotes').value.trim() || null,
        lastVaccinationDate: document.getElementById('editLastVaccinationDate').value || null,
        manualVaccinationDueDate: document.getElementById('editManualVaccinationDueDate').value || null,
        lastVaccinationNotes: document.getElementById('editLastVaccinationNotes').value.trim() || null,
    };

    if (updatedData.healthStatus === 'Deceased') {
        editSheepModal.hide();
        archiveRecord(recordId);
        return;
    }

    const isDuplicate = allRecords.some(
        record => record.id !== recordId && record.sheepId.toLowerCase() === updatedData.sheepId.toLowerCase()
    );
    if (isDuplicate) {
        alert(`Error: Another sheep with ID "${updatedData.sheepId}" already exists. Please use a unique ID.`);
        return;
    }
    update(ref(db, `sheepHealthRecords/${recordId}`), updatedData).then(() => editSheepModal.hide());
}

function deleteRecord(recordId, sheepId) {
    if (confirm(`Are you sure you want to PERMANENTLY DELETE sheep "${sheepId}" and all its history? This action cannot be undone.`)) {
        remove(ref(db, `sheepHealthRecords/${recordId}`))
            .catch(error => alert("An error occurred while deleting the record: " + error.message));
    }
}

function archiveRecord(recordId) {
    if (confirm('Are you sure you want to mark this sheep as deceased and move it to the archive? This action moves the record and cannot be easily undone.')) {
        const recordToArchive = allRecords.find(r => r.id === recordId);
        if (!recordToArchive) return alert("Record not found.");

        const archivedRecord = {
            ...recordToArchive,
            healthStatus: 'Deceased',
            archiveDate: new Date().toISOString().split('T')[0]
        };
        delete archivedRecord.id;

        push(ref(db, 'sheepArchivedRecords'), archivedRecord).then(() => {
            remove(ref(db, `sheepHealthRecords/${recordId}`));
        });
    }
}

function deleteSoldRecord(recordId, sheepId) {
    if (confirm(`Are you sure you want to PERMANENTLY DELETE the sale record for sheep "${sheepId}"? This action cannot be undone.`)) {
        remove(ref(db, `sheepSaledRecords/${recordId}`));
    }
}

function deleteArchivedRecord(recordId, sheepId) {
    if (confirm(`Are you sure you want to PERMANENTLY DELETE the archived record for sheep "${sheepId}"? This action cannot be undone.`)) {
        remove(ref(db, `sheepArchivedRecords/${recordId}`));
    }
}

function openSaleModal(recordId) {
    document.getElementById('saleRecordId').value = recordId;
    document.getElementById('saleDate').valueAsDate = new Date();
    saleSheepModal.show();
}

function handleSaleSubmit(e) {
    e.preventDefault();
    const recordId = document.getElementById('saleRecordId').value;
    const recordToSell = allRecords.find(r => r.id === recordId);
    if (!recordToSell) return alert("Record not found.");

    const soldRecord = {
        ...recordToSell,
        saleDate: document.getElementById('saleDate').value,
        salePrice: document.getElementById('salePrice').value,
        saleBuyer: document.getElementById('saleBuyer').value.trim(),
        saleNotes: document.getElementById('saleNotes').value.trim(),
    };
    delete soldRecord.id;

    push(ref(db, 'sheepSaledRecords'), soldRecord).then(() => {
        remove(ref(db, `sheepHealthRecords/${recordId}`)).then(() => {
            saleSheepModal.hide();
            e.target.reset();
        });
    });
}

function openTreatmentLog(recordId, sheepId) {
    document.getElementById('modalSheepId').textContent = sheepId;
    document.getElementById('currentSheepRecordId').value = recordId;
    resetTreatmentForm();

    // Pre-fill symptoms from the latest treatment if available
    const record = allRecords.find(r => r.id === recordId);
    if (record && record.treatments) {
        const treatments = Object.values(record.treatments).sort((a, b) => new Date(b.treatmentDate) - new Date(a.treatmentDate));
        if (treatments.length > 0 && treatments[0].symptoms) {
            document.getElementById('symptoms').value = treatments[0].symptoms;
        }
    }

    // Detach any previous listener to avoid multiple listeners running
    if (treatmentLogListener) {
        const { ref: oldRef, listener: oldListener } = treatmentLogListener;
        off(oldRef, 'value', oldListener);
    }

    // Attach a new live listener for the treatment log of the current sheep
    const treatmentsRef = ref(db, `sheepHealthRecords/${recordId}/treatments`);
    const listener = onValue(treatmentsRef, (snapshot) => {
        const treatmentLogTbody = document.getElementById('treatmentLogTbody');
        const treatmentsData = snapshot.val();
        if (treatmentsData) {
            const treatments = Object.entries(treatmentsData).sort((a, b) => new Date(b[1].treatmentDate) - new Date(a[1].treatmentDate));
            treatmentLogTbody.innerHTML = treatments.map(([id, t]) => `
                <tr>
                    <td>${formatDate(t.treatmentDate)}</td>
                    <td>${t.cost ? `₹${t.cost.toFixed(2)}` : ''}</td>
                    <td>${t.symptoms || ''}</td>
                    <td>${t.medication || ''}</td>
                    <td>${t.dosage || ''}</td>
                    <td>${t.treatmentNotes || ''}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary js-edit-treatment" data-record-id="${recordId}" data-entry-id="${id}"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-outline-danger js-delete-treatment" data-record-id="${recordId}" data-entry-id="${id}"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        } else {
            treatmentLogTbody.innerHTML = '<tr><td colspan="7" class="text-center">No treatments logged.</td></tr>';
        }
    });

    treatmentLogListener = { ref: treatmentsRef, listener: listener };

    treatmentLogModal.show();
}

function editTreatmentEntry(recordId, entryId) {
    const entryRef = ref(db, `sheepHealthRecords/${recordId}/treatments/${entryId}`);
    onValue(entryRef, snapshot => {
        const entry = snapshot.val();
        if (!entry) {
            alert('Error: The treatment entry could not be found. It may have been deleted.');
            resetTreatmentForm();
            return;
        }
        document.getElementById('treatmentEntryId').value = entryId;
        document.getElementById('treatmentType').value = entry.treatmentType || 'General';
        document.getElementById('treatmentDate').value = entry.treatmentDate;
        document.getElementById('symptoms').value = entry.symptoms || '';
        document.getElementById('medication').value = entry.medication || '';
        document.getElementById('dosage').value = entry.dosage || '';
        document.getElementById('followUpDate').value = entry.followUpDate || '';
        document.getElementById('treatmentWeight').value = '';
        document.getElementById('treatmentCost').value = entry.cost || '';
        document.getElementById('treatmentNotes').value = entry.treatmentNotes || '';
    }, { onlyOnce: true });
}

function deleteTreatmentEntry(recordId, entryId) {
    if (confirm('Delete this treatment entry?')) {
        remove(ref(db, `sheepHealthRecords/${recordId}/treatments/${entryId}`))
            .catch(error => {
                console.error("Error deleting treatment entry:", error);
                alert("Failed to delete treatment entry: " + error.message);
            });
    }
}

function handleSaveTreatment(e) {
    e.preventDefault();
    const recordId = document.getElementById('currentSheepRecordId').value;
    const entryId = document.getElementById('treatmentEntryId').value;
    const treatmentType = document.getElementById('treatmentType').value;
    const treatmentDate = document.getElementById('treatmentDate').value;
    const treatmentWeight = parseFloat(document.getElementById('treatmentWeight').value);
    const costEl = document.getElementById('treatmentCost');

    const entryData = {
        treatmentDate: treatmentDate,
        treatmentType: treatmentType,
        symptoms: document.getElementById('symptoms').value,
        medication: document.getElementById('medication').value,
        dosage: document.getElementById('dosage').value,
        followUpDate: document.getElementById('followUpDate').value,
        cost: costEl ? parseFloat(costEl.value) || null : null,
        treatmentNotes: document.getElementById('treatmentNotes').value,
    };

    if (!isNaN(treatmentWeight) && treatmentWeight > 0) {
        const weightData = { date: treatmentDate, weight: treatmentWeight };
        push(ref(db, `sheepHealthRecords/${recordId}/weights`), weightData);
    }

    const treatmentsRef = ref(db, `sheepHealthRecords/${recordId}/treatments`);
    const promise = entryId ? update(child(treatmentsRef, entryId), entryData) : push(treatmentsRef, entryData);

    promise.then(() => {
        const mainRecordUpdates = {};
        if (treatmentType === 'Deworming') {
            mainRecordUpdates.lastDewormingDate = treatmentDate;
            mainRecordUpdates.lastDewormingNotes = entryData.treatmentNotes;
        } else if (treatmentType === 'Vaccination') {
            mainRecordUpdates.lastVaccinationDate = treatmentDate;
            mainRecordUpdates.lastVaccinationNotes = entryData.treatmentNotes;
        }

        const record = allRecords.find(r => r.id === recordId);
        if (record && record.healthStatus === 'Corentin') {
            mainRecordUpdates.healthStatus = 'Under Treatment';
        }

        if (Object.keys(mainRecordUpdates).length > 0) {
            update(ref(db, `sheepHealthRecords/${recordId}`), mainRecordUpdates);
        }
        resetTreatmentForm();
    }).catch(error => {
        console.error("Error saving treatment:", error);
        alert("An error occurred while saving the treatment: " + error.message);
    });
}

function resetTreatmentForm() {
    document.getElementById('addTreatmentForm').reset();
    document.getElementById('treatmentEntryId').value = '';
    document.getElementById('treatmentDate').valueAsDate = new Date();
}

function handleBatchSaveTreatment(e) {
    e.preventDefault();
    const selectedCheckboxes = document.querySelectorAll('#scheduleTableBody .sheep-select-checkbox:checked');
    const recordIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.id);

    const treatmentType = document.getElementById('batchTreatmentType').value;
    const treatmentDate = document.getElementById('batchTreatmentDate').value;

    if (!treatmentType || !treatmentDate) {
        return alert('Treatment Type and Date are required.');
    }

    const entryData = {
        treatmentDate: treatmentDate,
        treatmentType: treatmentType,
        medication: document.getElementById('batchMedication').value,
        dosage: document.getElementById('batchDosage').value,
        treatmentNotes: document.getElementById('batchTreatmentNotes').value,
        symptoms: 'Batch logged treatment',
        followUpDate: ''
    };

    const allUpdates = {};
    recordIds.forEach(recordId => {
        const newTreatmentKey = push(child(ref(db), `sheepHealthRecords/${recordId}/treatments`)).key;
        allUpdates[`sheepHealthRecords/${recordId}/treatments/${newTreatmentKey}`] = entryData;

        if (treatmentType === 'Deworming') {
            allUpdates[`sheepHealthRecords/${recordId}/lastDewormingDate`] = treatmentDate;
            allUpdates[`sheepHealthRecords/${recordId}/lastDewormingNotes`] = entryData.treatmentNotes;
        } else if (treatmentType === 'Vaccination') {
            allUpdates[`sheepHealthRecords/${recordId}/lastVaccinationDate`] = treatmentDate;
            allUpdates[`sheepHealthRecords/${recordId}/lastVaccinationNotes`] = entryData.treatmentNotes;
        }
    });

    update(ref(db), allUpdates).then(() => batchTreatmentModal.hide());
}

function openEditSoldModal(recordId) {
    if (!editSoldSheepModal) {
        alert('Error: The edit modal is not available. Please check the console for errors.');
        return;
    }
    const record = soldRecords.find(r => r.id === recordId);
    if (!record) {
        alert('Error: Could not find the sold record to edit.');
        return;
    }
    // These element IDs must exist in a new modal in your HTML file
    document.getElementById('editSoldRecordId').value = recordId;
    document.getElementById('editSoldSheepId').textContent = record.sheepId; // Display only, not editable
    document.getElementById('editSoldBuyingPrice').value = record.buyingPrice || '';
    document.getElementById('editSoldSalePrice').value = record.salePrice || '';
    document.getElementById('editSoldSaleDate').value = record.saleDate || '';
    document.getElementById('editSoldSaleBuyer').value = record.saleBuyer || '';
    document.getElementById('editSoldSaleNotes').value = record.saleNotes || '';
    editSoldSheepModal.show();
}

function handleUpdateSoldRecord(e) {
    e.preventDefault();
    const recordId = document.getElementById('editSoldRecordId').value;
    if (!recordId) {
        alert('Error: No record ID found for update.');
        return;
    }

    const updatedData = {
        buyingPrice: parseFloat(document.getElementById('editSoldBuyingPrice').value) || null,
        salePrice: parseFloat(document.getElementById('editSoldSalePrice').value) || null,
        saleDate: document.getElementById('editSoldSaleDate').value,
        saleBuyer: document.getElementById('editSoldSaleBuyer').value.trim(),
        saleNotes: document.getElementById('editSoldSaleNotes').value.trim(),
    };

    if (!updatedData.saleDate) {
        return alert('Sale Date is a required field.');
    }

    update(ref(db, `sheepSaledRecords/${recordId}`), updatedData)
        .then(() => {
            if (editSoldSheepModal) {
                editSoldSheepModal.hide();
            }
        })
        .catch(error => {
            console.error("Error updating sold record:", error);
            alert("An error occurred while updating the sale record: " + error.message);
        });
}

// --- SHEEP PROFILE SECTION ---

function updateProfileView() {
    const selector = document.getElementById('profileSheepSelector');
    const currentSelection = selector.value;
    selector.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.textContent = 'Select a sheep to view profile';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    defaultOption.value = "";
    selector.appendChild(defaultOption);

    if (allRecords.length > 0) {
        const activeGroup = document.createElement('optgroup');
        activeGroup.label = 'Active Sheep';
        const sortedActive = [...allRecords].sort((a, b) => a.sheepId.localeCompare(b.sheepId, undefined, { numeric: true }));
        sortedActive.forEach(record => {
            const option = document.createElement('option');
            option.value = record.id;
            option.textContent = record.sheepId;
            activeGroup.appendChild(option);
        });
        selector.appendChild(activeGroup);
    }

    if (soldRecords.length > 0) {
        const soldGroup = document.createElement('optgroup');
        soldGroup.label = 'Sold Sheep';
        const sortedSold = [...soldRecords].sort((a, b) => a.sheepId.localeCompare(b.sheepId, undefined, { numeric: true }));
        sortedSold.forEach(record => {
            const option = document.createElement('option');
            option.value = record.id;
            option.textContent = record.sheepId;
            soldGroup.appendChild(option);
        });
        selector.appendChild(soldGroup);
    }

    if (archivedRecords.length > 0) {
        const archivedGroup = document.createElement('optgroup');
        archivedGroup.label = 'Archived Sheep';
        const sortedArchived = [...archivedRecords].sort((a, b) => a.sheepId.localeCompare(b.sheepId, undefined, { numeric: true }));
        sortedArchived.forEach(record => {
            const option = document.createElement('option');
            option.value = record.id;
            option.textContent = record.sheepId;
            archivedGroup.appendChild(option);
        });
        selector.appendChild(archivedGroup);
    }

    selector.value = currentSelection || "";

    if (!currentSelection) {
        document.getElementById('profileDisplayArea').style.display = 'none';
        document.getElementById('noProfileData').style.display = 'block';
        document.getElementById('profileEditBtn').style.display = 'none';
    }
    updateProfileNavButtons();
}

function renderProfileForSheep(recordId) {
    const displayArea = document.getElementById('profileDisplayArea');
    const noDataMessage = document.getElementById('noProfileData');
    const editBtn = document.getElementById('profileEditBtn');

    const combinedRecords = [...allRecords, ...soldRecords, ...archivedRecords];
    const record = combinedRecords.find(r => r.id === recordId);

    if (!record) {
        displayArea.style.display = 'none';
        noDataMessage.style.display = 'block';
        editBtn.style.display = 'none';
        noDataMessage.textContent = 'Could not find the selected sheep record.';
        return;
    }

    displayArea.style.display = 'block';
    noDataMessage.style.display = 'none';

    const isActiveRecord = allRecords.some(r => r.id === recordId);
    editBtn.style.display = isActiveRecord ? 'block' : 'none';

    updateElement('profileSheepId', record.sheepId);
    updateElement('profileHealthStatus', `<span class="badge fs-6 ${getBootstrapStatusClass(record.healthStatus)}">${record.healthStatus}</span>`, true);
    updateElement('profileAge', calculateAge(record.dateRecorded));
    updateElement('profileDateRecorded', formatDate(record.dateRecorded));
    updateElement('profileGender', record.gender || 'N/A');
    updateElement('profileBreed', record.breed || 'N/A');
    updateElement('profileBuyingPrice', record.buyingPrice ? `₹${parseFloat(record.buyingPrice).toFixed(2)}` : 'N/A');
    updateElement('profileInitialNotes', record.notes || 'No notes recorded.');

    const saleInfoCard = document.getElementById('profileSaleInfoCard');
    if (record.saleDate) {
        saleInfoCard.style.display = 'block';
        updateElement('profileSaleDate', formatDate(record.saleDate));
        updateElement('profileSalePrice', record.salePrice ? `₹${parseFloat(record.salePrice).toFixed(2)}` : 'N/A');
        updateElement('profileSaleBuyer', record.saleBuyer || 'N/A');
        updateElement('profileSaleNotes', record.saleNotes || 'N/A');

        // Calculate and display profit/loss
        const buyingPrice = parseFloat(record.buyingPrice) || 0;
        const treatmentCosts = record.treatments ? Object.values(record.treatments).reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0) : 0;
        const totalCost = buyingPrice + treatmentCosts;
        const salePrice = parseFloat(record.salePrice) || 0;
        const profit = salePrice - totalCost;

        let profitClass = '';
        if (profit > 0) profitClass = 'text-success';
        else if (profit < 0) profitClass = 'text-danger';

        updateElement('profileProfitLoss', `₹${profit.toFixed(2)}`);
        document.getElementById('profileProfitLoss')?.setAttribute('class', `fw-bold ${profitClass}`);
    } else {
        saleInfoCard.style.display = 'none';
    }

    // --- Preventative Care ---
    const dewormingStatus = getScheduleStatus(record.lastDewormingDate, 30, null);
    const vaccinationStatus = getScheduleStatus(record.lastVaccinationDate, 365, record.manualVaccinationDueDate);
    updateElement('profileDewormingStatus', renderScheduleStatusBadge(dewormingStatus, record.lastDewormingDate), true);
    updateElement('profileDewormingNotes', record.lastDewormingNotes || 'No notes recorded.');
    updateElement('profileVaccinationStatus', renderScheduleStatusBadge(vaccinationStatus, record.lastVaccinationDate), true);
    updateElement('profileVaccinationNotes', record.lastVaccinationNotes || 'No notes recorded.');

    // --- Right Column Renders ---
    renderWeightProfile(record);
    renderTreatmentProfile(record);
    updateProfileNavButtons();
}

function renderWeightProfile(record) {
    const chartContainer = document.getElementById('profileWeightChartContainer');

    const startDate = new Date(record.dateRecorded + 'T00:00:00');
    if (isNaN(startDate.getTime())) {
        chartContainer.innerHTML = '<div class="alert alert-warning">Cannot display weight chart due to invalid start date.</div>';
        return;
    }

    const allWeightPoints = gatherAllWeightData(record);
    renderWeightDataTable(allWeightPoints, record.id, 'profileWeightTableContainer');
    calculateAndDisplayWeightStats(allWeightPoints, 'profileWeightStatsBody');

    const chartPoints = allWeightPoints.map(dp => ({ x: (dp.date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 7), y: dp.weight }));

    if (chartPoints.length < 1) {
        chartContainer.innerHTML = '<div class="alert alert-info text-center h-100 d-flex align-items-center justify-content-center">No weight data to display.</div>';
        if (profileWeightChart) { profileWeightChart.destroy(); profileWeightChart = null; }
        return;
    } else {
        chartContainer.innerHTML = '<canvas id="profileWeightChart"></canvas>';
    }

    const ctx = document.getElementById('profileWeightChart').getContext('2d');
    if (profileWeightChart) { profileWeightChart.destroy(); }

    profileWeightChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{ label: `Weight (kg) for ${record.sheepId}`, data: chartPoints, borderColor: '#0d6efd', backgroundColor: 'rgba(13, 110, 253, 0.1)', fill: true, tension: 0.1, pointRadius: 5, pointHoverRadius: 7 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Weeks Since Record Start Date' }, min: 0 },
                y: { title: { display: true, text: 'Weight (kg)' }, beginAtZero: true }
            },
            plugins: { tooltip: { callbacks: {
                title: context => `Week ${context[0].raw.x.toFixed(1)}`,
                label: context => `Weight: ${context.raw.y} kg`
            }}}
        }
    });
}

function renderTreatmentProfile(record) {
    const tbody = document.getElementById('profileTreatmentHistoryTbody');
    const treatments = record.treatments ? Object.values(record.treatments).sort((a, b) => new Date(b.treatmentDate) - new Date(a.treatmentDate)) : [];

    if (treatments.length > 0) {
        tbody.innerHTML = treatments.map(entry => `<tr>
            <td>${formatDate(entry.treatmentDate)}</td>
            <td>${entry.treatmentType || 'General'}</td>
            <td>${entry.cost ? `₹${entry.cost.toFixed(2)}` : ''}</td>
            <td>${entry.symptoms || ''}</td>
            <td>${entry.medication || ''}</td>
            <td>${entry.dosage || ''}</td>
            <td>${entry.treatmentNotes || ''}</td>
        </tr>`).join('');
    } else {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No treatment history recorded.</td></tr>';
    }
}

function updateProfileNavButtons() {
    const selector = document.getElementById('profileSheepSelector');
    const prevBtn = document.getElementById('prevSheepBtn');
    const nextBtn = document.getElementById('nextSheepBtn');

    const options = Array.from(selector.options).filter(opt => !opt.disabled && opt.style.display !== 'none');
    const currentIndex = options.findIndex(opt => opt.value === selector.value);

    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= options.length - 1 || currentIndex === -1;
}

function navigateProfile(direction) {
    const selector = document.getElementById('profileSheepSelector');
    const options = Array.from(selector.options).filter(opt => !opt.disabled && opt.style.display !== 'none');
    const currentIndex = options.findIndex(opt => opt.value === selector.value);

    if (currentIndex === -1) return;

    const newIndex = currentIndex + direction;

    if (newIndex >= 0 && newIndex < options.length) {
        const newRecordId = options[newIndex].value;
        selector.value = newRecordId;
        selector.dispatchEvent(new Event('change'));
    }
}

function openWeightModal(recordId, entryId = null, source = 'log') {
    document.getElementById('weightEntryForm').reset();
    document.getElementById('weightRecordId').value = recordId;
    document.getElementById('weightEntryId').value = entryId || '';
    document.getElementById('weightEntrySource').value = source;

    if (entryId) {
        document.getElementById('weightModalTitle').textContent = 'Edit Weight Entry';
        const combinedRecords = [...allRecords, ...soldRecords, ...archivedRecords];
        const record = combinedRecords.find(r => r.id === recordId);
        if (!record) return;

        let dataPoint;
        if (source === 'initial') {
            dataPoint = { date: record.dateRecorded, weight: record.weight };
        } else if (source === 'log' && record.weights) {
            dataPoint = record.weights[entryId];
        }

        if (dataPoint) {
            document.getElementById('weightEntryDate').value = dataPoint.date;
            document.getElementById('weightEntryValue').value = dataPoint.weight;
        }
    } else {
        document.getElementById('weightModalTitle').textContent = 'Add Weight Entry';
        document.getElementById('weightEntryDate').valueAsDate = new Date();
    }
    weightEntryModal.show();
}

function handleSaveWeight(e) {
    e.preventDefault();
    const recordId = document.getElementById('weightRecordId').value;
    const entryId = document.getElementById('weightEntryId').value;
    const source = document.getElementById('weightEntrySource').value;
    const date = document.getElementById('weightEntryDate').value;
    const weight = parseFloat(document.getElementById('weightEntryValue').value);

    if (!date || isNaN(weight)) {
        return alert('Please provide a valid date and weight.');
    }

    let recordPath;
    if (allRecords.some(r => r.id === recordId)) {
        recordPath = `sheepHealthRecords/${recordId}`;
    } else if (soldRecords.some(r => r.id === recordId)) {
        recordPath = `sheepSaledRecords/${recordId}`;
    } else if (archivedRecords.some(r => r.id === recordId)) {
        recordPath = `sheepArchivedRecords/${recordId}`;
    }

    if (!recordPath) {
        return alert('Could not find the record to update.');
    }

    let promise;
    if (source === 'initial') {
        promise = update(ref(db, recordPath), { weight: weight, dateRecorded: date });
    } else {
        const data = { date, weight };
        const path = ref(db, `${recordPath}/weights`);
        promise = entryId ? update(child(path, entryId), data) : push(path, data);
    }

    promise.then(() => {
        weightEntryModal.hide();
    }).catch(err => alert('Error saving weight: ' + err.message));
}

function deleteWeightEntry(recordId, entryId, source) {
    if (!confirm('Are you sure you want to delete this weight entry?')) return;

    let recordPath;
    if (allRecords.some(r => r.id === recordId)) {
        recordPath = `sheepHealthRecords/${recordId}`;
    } else if (soldRecords.some(r => r.id === recordId)) {
        recordPath = `sheepSaledRecords/${recordId}`;
    } else if (archivedRecords.some(r => r.id === recordId)) {
        recordPath = `sheepArchivedRecords/${recordId}`;
    }

    if (!recordPath) {
        return alert('Could not find the record to update.');
    }

    let promise;
    if (source === 'initial') {
        promise = remove(ref(db, `${recordPath}/weight`));
    } else if (source === 'log') {
        promise = remove(ref(db, `${recordPath}/weights/${entryId}`));
    } else if (source === 'treatment') {
        promise = remove(ref(db, `${recordPath}/treatments/${entryId}/weight`));
    }
    if (promise) {
        promise.catch(err => alert('Error deleting entry: ' + err.message));
    }
}

// --- UTILITY FUNCTIONS ---

function getBootstrapStatusClass(status) {
    if (status === 'Healthy' || status === 'Recovering') return 'bg-success';
    if (status === 'Corentin' || status === 'Deceased') return 'bg-danger';
    if (status === 'Under Treatment') return 'bg-warning text-dark';
    if (status === 'Pregnant') return 'bg-purple'; // You might need to define this class in your CSS
    return 'bg-secondary';
}

function calculateAge(startDateString) {
    if (!startDateString) return 'N/A';
    const startDate = new Date(startDateString + 'T00:00:00');
    if (isNaN(startDate.getTime())) return 'N/A';

    const today = new Date();
    const birthDate = new Date(startDate);

    let years = today.getFullYear() - birthDate.getFullYear();
    let months = today.getMonth() - birthDate.getMonth();

    if (months < 0 || (months === 0 && today.getDate() < birthDate.getDate())) {
        years--;
        months = (months + 12) % 12;
    }

    if (years === 0 && months === 0) {
        const days = Math.floor((today - birthDate) / (1000 * 60 * 60 * 24));
        return `${days} day${days !== 1 ? 's' : ''}`;
    }

    let ageString = '';
    if (years > 0) ageString += `${years} year${years > 1 ? 's' : ''}`;
    if (months > 0) ageString += ` ${months} month${months > 1 ? 's' : ''}`;
    return ageString.trim();
}

function getStatusClass(status) {
    if (status === 'Healthy' || status === 'Recovering') return 'status-healthy';
    if (status === 'Corentin' || status === 'Deceased') return 'status-corentin';
    if (status === 'Under Treatment') return 'status-treatment';
    if (status === 'Pregnant') return 'status-pregnant';
    return '';
}

function filterTableBySheepId(inputElement, tableBodyId) {
    const searchTerm = inputElement.value.toLowerCase();
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll('tr');
    rows.forEach(row => {
        if (row.cells.length > 0) {
            const sheepId = row.cells[0]?.textContent.toLowerCase() || '';
            row.style.display = sheepId.includes(searchTerm) ? '' : 'none';
        }
    });
}

function filterProfileSelector() {
    const searchTerm = document.getElementById('profileSearchInput').value.toLowerCase();
    const selector = document.getElementById('profileSheepSelector');

    for (const option of selector.options) {
        if (option.disabled) continue;
        const optionText = option.textContent.toLowerCase();
        option.style.display = optionText.includes(searchTerm) ? '' : 'none';
    }

    for (const group of selector.getElementsByTagName('optgroup')) {
        let allOptionsHidden = true;
        for (const option of group.options) {
            if (option.style.display !== 'none') {
                allOptionsHidden = false;
                break;
            }
        }
        group.style.display = allOptionsHidden ? 'none' : '';
    }
    updateProfileNavButtons();
}

function exportCorentinData() {
    const recordsToExport = allRecords.filter(r => r.healthStatus === 'Corentin');
    if (recordsToExport.length === 0) {
        alert('No Corentin records to export.');
        return;
    }
    const csv = convertToCSV(recordsToExport);
    downloadCSV(csv, 'corentin_sheep_records.csv');
}

function exportUnderTreatmentData() {
    const recordsToExport = allRecords.filter(r => r.healthStatus === 'Under Treatment');
    if (recordsToExport.length === 0) {
        alert('No Under Treatment records to export.');
        return;
    }
    const csv = convertToCSV(recordsToExport);
    downloadCSV(csv, 'under_treatment_sheep_records.csv');
}

function exportOverdueData() {
    // Re-calculate overdue records for export to ensure it's current
    const recordsToExport = allRecords.filter(r => (r.healthStatus === 'Corentin' || r.healthStatus === 'Under Treatment') && getFollowUpStatus(r) === 'overdue');
    if (recordsToExport.length === 0) {
        alert('No overdue records to export.');
        return;
    }
    const csv = convertToCSV(recordsToExport);
    downloadCSV(csv, 'overdue_sheep_records.csv');
}

function exportSoldData() {
    if (soldRecords.length === 0) {
        alert('No sold records to export.');
        return;
    }
    const csv = convertSoldToCSV(soldRecords);
    downloadCSV(csv, 'sold_sheep_records.csv');
}

function convertSoldToCSV(data) {
    const headers = ['Sheep ID', 'Date Sold', 'Sale Price', 'Buying Price', 'Treatment Costs', 'Total Cost', 'Profit/Loss', 'Buyer', 'Notes'];
    const rows = data.map(record => {
        const buyingPrice = parseFloat(record.buyingPrice) || 0;
        const treatmentCosts = record.treatments ? Object.values(record.treatments).reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0) : 0;
        const totalCost = buyingPrice + treatmentCosts;
        const salePrice = parseFloat(record.salePrice) || 0;
        const profit = salePrice - totalCost;
        return [
            `"${record.sheepId || ''}"`, `"${record.saleDate || ''}"`,
            `"${salePrice.toFixed(2)}"`, `"${buyingPrice.toFixed(2)}"`,
            `"${treatmentCosts.toFixed(2)}"`, `"${totalCost.toFixed(2)}"`,
            `"${profit.toFixed(2)}"`, `"${record.saleBuyer || ''}"`,
            `"${(record.saleNotes || '').replace(/"/g, '""')}"`
        ].join(',');
    });
    return [headers.join(','), ...rows].join('\n');
}

function exportData() {
    const recordsToExport = allRecords.filter(r => r.healthStatus === 'Healthy' || r.healthStatus === 'Recovering');
    if (recordsToExport.length === 0) {
        alert('No healthy or recovering records to export.');
        return;
    }
    const csv = convertToCSV(recordsToExport);
    downloadCSV(csv, 'healthy_sheep_records.csv');
}

function convertToCSV(data) {
    const headers = ['Sheep ID', 'Gender', 'Breed', 'Health Status', 'Date Recorded', 'Weight (kg)', 'Temperature (°C)', 'Buying Price', 'Notes'];
    const rows = data.map(record =>
        [
            `"${record.sheepId || ''}"`,
            `"${record.gender || ''}"`,
            `"${record.breed || ''}"`,
            `"${record.healthStatus || ''}"`,
            `"${record.dateRecorded || ''}"`,
            `"${record.weight || ''}"`,
            `"${record.temperature || ''}"`,
            `"${record.buyingPrice || ''}"`,
            `"${(record.notes || '').replace(/"/g, '""')}"`
        ].join(',')
    );
    return [headers.join(','), ...rows].join('\n');
}

function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// --- APP INITIALIZATION ---

/**
 * Initializes the main application UI, modals, and event listeners.
 */
function initializeUI() {
    const initializeModal = (id) => {
        const element = document.getElementById(id);
        if (element) {
            return new bootstrap.Modal(element);
        }
        console.error(`Modal initialization failed: Element with ID '${id}' not found in the HTML.`);
        return null;
    };

    // Initialize Bootstrap Modals
    editSheepModal = initializeModal('editSheepModal');
    saleSheepModal = initializeModal('saleSheepModal');
    treatmentLogModal = initializeModal('treatmentLogModal');
    weightEntryModal = initializeModal('weightEntryModal');
    batchTreatmentModal = initializeModal('batchTreatmentModal');
    editSoldSheepModal = initializeModal('editSoldSheepModal');

    // Set default date for new records
    document.getElementById('dateRecorded').valueAsDate = new Date();

    addEventListeners();

    // Initial data fetch
    fetchAllRecords();
    fetchSoldRecords();
    fetchArchivedRecords();
}

/**
 * Centralized function to add all necessary event listeners for the app.
 */
function addEventListeners() {
    /**
     * A helper to safely add an event listener to an element by its ID.
     * Prevents crashes if the element doesn't exist in the DOM.
     * @param {string} elementId The ID of the element.
     * @param {string} event The event to listen for (e.g., 'click').
     * @param {Function} handler The function to execute.
     */
    const addSafeEventListener = (elementId, event, handler) => {
        const element = document.getElementById(elementId);
        if (element) element.addEventListener(event, handler);
        else console.warn(`Event listener for '${event}' on '#${elementId}' could not be attached because the element was not found.`);
    };
    // --- Main App Click Handler (Event Delegation) ---
    mainApp.addEventListener('click', (e) => {
        const target = e.target;
        const recordBtn = target.closest('[data-record-id]');
        const recordId = recordBtn?.dataset.recordId;
        const sheepId = recordBtn?.dataset.sheepId;

        // Table row actions
        if (target.closest('.js-edit-record')) openEditModal(recordId);
        else if (target.closest('.js-sale-record')) openSaleModal(recordId);
        else if (target.closest('.js-delete-record')) deleteRecord(recordId, sheepId);
        else if (target.closest('.js-archive-record')) archiveRecord(recordId);
        else if (target.closest('.js-manage-treatment')) openTreatmentLog(recordId, sheepId);
        else if (target.closest('.js-edit-treatment')) editTreatmentEntry(recordId, recordBtn.dataset.entryId);
        else if (target.closest('.js-delete-treatment')) deleteTreatmentEntry(recordId, recordBtn.dataset.entryId);
        else if (target.closest('.js-delete-sold-record')) deleteSoldRecord(recordId, sheepId);
        else if (target.closest('.js-delete-archived-record')) deleteArchivedRecord(recordId, sheepId);
        else if (target.closest('.js-edit-sold-record')) openEditSoldModal(recordId);
        else if (target.closest('.js-edit-weight')) openWeightModal(recordId, recordBtn.dataset.entryId, recordBtn.dataset.source);
        else if (target.closest('.js-delete-weight')) deleteWeightEntry(recordId, recordBtn.dataset.entryId, recordBtn.dataset.source);
        
        // Other buttons
        else if (target.closest('#signOutBtn')) signOut(auth);
        else if (target.closest('#sidebarToggleBtn')) document.querySelector('.dashboard-sidebar').classList.toggle('visible');
        else if (target.closest('#batchLogBtn')) openBatchLogModal();
        else if (target.closest('.js-reset-treatment-form')) resetTreatmentForm();
        else if (target.closest('#prevSheepBtn')) navigateProfile(-1);
        else if (target.closest('#nextSheepBtn')) navigateProfile(1);
        else if (target.closest('#profileEditBtn')) {
            const selectedId = document.getElementById('profileSheepSelector').value;
            if (selectedId) openEditModal(selectedId);
        }
        else if (target.closest('.js-export-healthy')) exportData();
        else if (target.closest('.js-export-corentin')) exportCorentinData();
        else if (target.closest('.js-export-under-treatment')) exportUnderTreatmentData();
        else if (target.closest('.js-export-overdue')) exportOverdueData();
        else if (target.closest('.js-export-sold')) exportSoldData();
        else if (target.closest('.notification-item')) {
            e.preventDefault();
            viewRecordFromNotification(target.closest('.notification-item').dataset.recordId);
        }
        else if (target.closest('.profile-link')) {
            e.preventDefault();
            const profileId = target.closest('.profile-link').dataset.sheepId;
            showSection('profile');
            document.getElementById('profileSheepSelector').value = profileId;
            renderProfileForSheep(profileId);
        }
    });

    // --- Modal Listeners ---
    addSafeEventListener('treatmentLogModal', 'hidden.bs.modal', () => {
        if (treatmentLogListener) {
            off(treatmentLogListener.ref, 'value', treatmentLogListener.listener);
            treatmentLogListener = null;
        }
    });
    document.querySelector('.dashboard-sidebar .nav').addEventListener('click', e => {
        const link = e.target.closest('a.nav-link[data-section]');
        if (link) {
            e.preventDefault();
            showSection(link.dataset.section);
        }
    });

    // --- Form Submissions ---
    addSafeEventListener('sheepHealthForm', 'submit', handleAddRecord);
    addSafeEventListener('editSheepForm', 'submit', handleUpdateRecord);
    addSafeEventListener('saleSheepForm', 'submit', handleSaleSubmit);
    addSafeEventListener('addTreatmentForm', 'submit', handleSaveTreatment);
    addSafeEventListener('batchTreatmentForm', 'submit', handleBatchSaveTreatment);
    addSafeEventListener('editSoldSheepForm', 'submit', handleUpdateSoldRecord);
    addSafeEventListener('weightEntryForm', 'submit', handleSaveWeight);

    // --- Filters & Search ---
    addSafeEventListener('scheduleFilterButtons', 'click', e => { if (e.target.matches('button')) updateScheduleView(e.target.dataset.filter); });
    addSafeEventListener('weeklyFilterButtons', 'click', e => { if (e.target.matches('button')) updateWeeklyTrackingView(e.target.dataset.filter); });

    mainApp.addEventListener('keyup', e => {
        if (e.target.matches('input[data-table-body-id]')) {
            filterTableBySheepId(e.target, e.target.dataset.tableBodyId);
        } else if (e.target.matches('#profileSearchInput')) {
            filterProfileSelector();
        }
    });

    // --- Dynamic UI Listeners ---
    addSafeEventListener('scheduleTableBody', 'change', e => { if (e.target.matches('.sheep-select-checkbox')) updateBatchLogUI(); });
    addSafeEventListener('selectAllSchedule', 'change', e => {
        document.querySelectorAll('#scheduleTableBody .sheep-select-checkbox').forEach(cb => cb.checked = e.target.checked);
        updateBatchLogUI();
    });
    addSafeEventListener('profileSheepSelector', 'change', e => { if (e.target.value) renderProfileForSheep(e.target.value); });
    addSafeEventListener('weightSheepSelector', 'change', e => { if (e.target.value) renderWeightChartForSheep(e.target.value); });
    addSafeEventListener('addWeightBtn', 'click', () => {
        const recordId = document.getElementById('weightSheepSelector')?.value;
        if (recordId) openWeightModal(recordId);
    });
}