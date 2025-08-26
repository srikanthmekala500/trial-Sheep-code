let healthStatusPieChartInstance = null;

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getDatabase, ref, onValue, off, push, update, remove, child, query } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js";

console.log("app.js loaded successfully."); // Diagnostic log to confirm file version
// --- CONFIGURATION ---


const firebaseConfig = { apiKey: "AIzaSyBdiEUorFPkiZAya84Xzx17id82nB77Zg4", authDomain: "sheep-1b6a7.firebaseapp.com", databaseURL: "https://sheep-1b6a7-default-rtdb.firebaseio.com", projectId: "sheep-1b6a7", storageBucket: "sheep-1b6a7.firebasestorage.app", messagingSenderId: "243565434909", appId: "1:243565434909:web:25312f89033e3fd0d54ef4" };

// --- FIREBASE INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// --- STATE VARIABLES ---
let masterAllRecords = [];
let masterSoldRecords = [];
let masterArchivedRecords = [];
let allRecords = [];
let soldRecords = [];
let archivedRecords = [];
let editSheepModal, saleSheepModal, treatmentLogModal, weightEntryModal, batchTreatmentModal, editSoldSheepModal;
let state = {
    growthAnalyticsData: [], // Stores the raw calculated growth data for filtering/sorting
    currentGrowthFilters: { gender: 'all', breed: 'all', searchTerm: '' }
};

let weightChart, profileWeightChart, profitLossChart;
let currentWeeklyFilter = 'all';
let currentScheduleFilter = 'all';
let currentSoldFilter = 'all';
let growthAnalyticsSort = { column: 'adg', direction: 'desc' };
let monthlySummarySort = 'newest'; // To store the current sort order for the monthly summary
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

    if (sectionName === 'growth') {
        displayGrowthAnalytics();
    }
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

function applyFiltersAndRender() {
    const yearFilter = document.getElementById('globalYearFilter')?.value || 'all';
    const monthFilter = document.getElementById('globalMonthFilter')?.value || 'all';
    const clearBtn = document.getElementById('globalDateClearBtn');

    if (clearBtn) {
        clearBtn.style.display = (yearFilter !== 'all' || monthFilter !== 'all') ? 'inline-block' : 'none';
    }

    // Filter Active Records
    allRecords = masterAllRecords.filter(record => {
        if (yearFilter === 'all' && monthFilter === 'all') return true;
        if (!record.dateRecorded) return false;
        const recordDate = new Date(record.dateRecorded + 'T00:00:00');
        if (isNaN(recordDate.getTime())) return false;
        if (yearFilter !== 'all' && recordDate.getFullYear().toString() !== yearFilter) return false;
        if (monthFilter !== 'all' && recordDate.getMonth().toString() !== monthFilter) return false;
        return true;
    });

    // Filter Sold Records
    soldRecords = masterSoldRecords.filter(record => {
        if (yearFilter === 'all' && monthFilter === 'all') return true;
        if (!record.saleDate) return false;
        const recordDate = new Date(record.saleDate + 'T00:00:00');
        if (isNaN(recordDate.getTime())) return false;
        if (yearFilter !== 'all' && recordDate.getFullYear().toString() !== yearFilter) return false;
        if (monthFilter !== 'all' && recordDate.getMonth().toString() !== monthFilter) return false;
        return true;
    });

    // Filter Archived Records
    archivedRecords = masterArchivedRecords.filter(record => {
        if (yearFilter === 'all' && monthFilter === 'all') return true;
        if (!record.archiveDate) return false;
        const recordDate = new Date(record.archiveDate + 'T00:00:00');
        if (isNaN(recordDate.getTime())) return false;
        if (yearFilter !== 'all' && recordDate.getFullYear().toString() !== yearFilter) return false;
        if (monthFilter !== 'all' && recordDate.getMonth().toString() !== monthFilter) return false;
        return true;
    });
    
    // Re-render all views with the filtered data
    displayGrowthAnalytics();
    renderAllRecordTables();
    renderSoldView();
    renderArchivedView();
    updateFlockStatus();
    updateProfileView();
    updateWeightTrackingView();
    updateScheduleView();
    updateWeeklyTrackingView();
}

function renderAllRecordTables() {
    let healthyHtml = '';
    let corentinRecords = [];
    let overdueRecords = [];
    let underTreatmentRecords = [];
    let pregnantRecords = [];

    allRecords.forEach(record => {
        const status = record.healthStatus;

        if (status === 'Healthy' || status === 'Recovering') {
            healthyHtml += renderHealthyRow(record);
        } else if (status === 'Corentin' || status === 'Under Treatment') {
            if (getFollowUpStatus(record) === 'overdue') {
                overdueRecords.push(record);
            } else {
                if (status === 'Corentin') {
                    corentinRecords.push(record);
                } else {
                    underTreatmentRecords.push(record);
                }
            }
        } else if (status === 'Pregnant') {
            pregnantRecords.push(record);
        }
    });

    const overdueHtml = overdueRecords.map(renderTreatmentRow).join('');
    const corentinHtml = corentinRecords.map(renderTreatmentRow).join('');
    const treatmentHtml = underTreatmentRecords.map(renderTreatmentRow).join('');
    const pregnantHtml = pregnantRecords.map(renderPregnantRow).join('');

    updateElement('healthyRecordsTableBody', healthyHtml || `<tr><td colspan="10" class="text-center">No healthy records match the filter.</td></tr>`, true);
    updateElement('overdueRecordsTableBody', overdueHtml || `<tr><td colspan="6" class="text-center">No overdue records. Great job!</td></tr>`, true);
    updateElement('corentinRecordsTableBody', corentinHtml || `<tr><td colspan="6" class="text-center">No 'Corentin' records match the filter.</td></tr>`, true);
    updateElement('treatmentRecordsTableBody', treatmentHtml || `<tr><td colspan="6" class="text-center">No 'Under Treatment' records match the filter.</td></tr>`, true);
    updateElement('pregnantRecordsTableBody', pregnantHtml || `<tr><td colspan="6" class="text-center">No 'Pregnant' records match the filter.</td></tr>`, true);
}

function fetchAllRecords() {
    const recordsRef = ref(db, "sheepHealthRecords");
    onValue(recordsRef, (snapshot) => {
        masterAllRecords = [];

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const record = { id: child.key, ...child.val() };
                masterAllRecords.push(record);
            });
        }

        populateGlobalFilters();
        applyFiltersAndRender();
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

function renderSoldView() {
    const monthlyTotals = {};
    const yearlyTotals = {};

    masterSoldRecords.forEach(record => { // Changed from soldRecords to masterSoldRecords
        try {
            if (record.saleDate && record.salePrice != null) {
                const saleDate = new Date(record.saleDate + 'T00:00:00');
                if (!isNaN(saleDate.getTime())) {
                    const monthKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`;
                    const yearKey = `${saleDate.getFullYear()}`;
                    if (!monthlyTotals[monthKey]) monthlyTotals[monthKey] = { sales: 0, profit: 0 };
                    if (!yearlyTotals[yearKey]) yearlyTotals[yearKey] = { sales: 0, profit: 0 };
                    const salePrice = parseFloat(record.salePrice) || 0;
                    const buyingPrice = parseFloat(record.buyingPrice) || 0;
                    const treatmentCosts = (record.treatments && typeof record.treatments === 'object') ? Object.values(record.treatments).reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0) : 0;
                    const totalCost = buyingPrice + treatmentCosts;
                    const profit = salePrice - totalCost;
                    monthlyTotals[monthKey].sales += salePrice;
                    monthlyTotals[monthKey].profit += profit;
                    yearlyTotals[yearKey].sales += salePrice;
                    yearlyTotals[yearKey].profit += profit;
                }
            }
        } catch (e) { console.error(`Error processing sold record ${record.id}:`, e); }
    });

    renderMonthlySalesSummary(monthlyTotals);
    renderYearlySalesSummary(yearlyTotals);
    renderProfitLossChart(monthlyTotals);
    updateSoldRecordsView(); // This will render the table with the filtered data
}

function fetchSoldRecords() {
    const recordsRef = ref(db, "sheepSaledRecords");
    onValue(recordsRef, snapshot => {
        masterSoldRecords = [];
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const record = { id: child.key, ...child.val() };
                masterSoldRecords.push(record);
            });
        }
        populateGlobalFilters();
        applyFiltersAndRender();
    }, error => {
        console.error("Error fetching sold records:", error);
        document.getElementById('sheepSaledTableBody').innerHTML = `<tr><td colspan="5" class="text-center text-danger p-4">Error loading sold records. Check browser console for details.</td></tr>`;
    });
}

function renderArchivedView() {
    const tableBody = document.getElementById('archivedRecordsTableBody');
    if (!tableBody) return;
    const rowsHtml = archivedRecords.map(renderArchivedRow).join('');
    tableBody.innerHTML = rowsHtml || `<tr><td colspan="6" class="text-center">No archived records match the filter.</td></tr>`;
}

function fetchArchivedRecords() {
    const recordsRef = ref(db, "sheepArchivedRecords");
    onValue(recordsRef, snapshot => {
        masterArchivedRecords = [];
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const record = { id: child.key, ...child.val() };
                masterArchivedRecords.push(record);
            });
        }
        populateGlobalFilters();
        applyFiltersAndRender();
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
    const treatmentCosts = (record.treatments && typeof record.treatments === 'object')
        ? Object.values(record.treatments).reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0)
        : 0;
    const totalCost = buyingPrice + treatmentCosts;
    const profit = salePrice - totalCost;

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
                <div class="d-flex justify-content-between small text-muted"><span>Treatment Costs</span><span>- ₹${treatmentCosts.toFixed(2)}</span></div>
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


function renderMonthlySalesSummary(monthlyTotals, sortBy = monthlySummarySort) {
    // monthlySummarySort = sortBy; // This is now handled by the caller to avoid side-effects

    const container = document.getElementById('monthlySalesSummary');
    if (!container) {
        return; // Not an error if the element is not on the current page.
    }

    // Update the active state on the sort buttons
    const sortButtons = document.querySelectorAll('#monthlySalesSort button');
    if (sortButtons.length > 0) {
        sortButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.sort === sortBy);
        });
    }

    if (Object.keys(monthlyTotals).length === 0) {
        container.innerHTML = '<p class="text-muted text-center p-3 mb-0">No sales data available.</p>';
        return;
    }

    let sortedMonths;
    const monthEntries = Object.entries(monthlyTotals);

    switch (sortBy) {
        case 'profit':
            sortedMonths = monthEntries.sort(([, a], [, b]) => b.profit - a.profit).map(([key]) => key);
            break;
        case 'sales':
            sortedMonths = monthEntries.sort(([, a], [, b]) => b.sales - a.sales).map(([key]) => key);
            break;
        case 'newest':
        default:
            sortedMonths = Object.keys(monthlyTotals).sort().reverse();
            break;
    }

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

function renderYearlySalesSummary(yearlyTotals) {
    const container = document.getElementById('yearlySalesSummary');
    if (!container) {
        console.error("UI Error: HTML element with ID 'yearlySalesSummary' not found.");
        return;
    }

    if (Object.keys(yearlyTotals).length === 0) {
        container.innerHTML = '<p class="text-muted text-center p-3 mb-0">No sales data available for years.</p>';
        return;
    }

    // Sort years chronologically, newest first, and limit to the last 5 years for a clean look
    const sortedYears = Object.keys(yearlyTotals).sort().reverse().slice(0, 5);

    let listHtml = '<ul class="list-group list-group-flush">';
    sortedYears.forEach(yearKey => {
        const yearData = yearlyTotals[yearKey];
        const { sales, profit } = yearData;

        const profitClass = profit >= 0 ? 'text-success' : 'text-danger';
        const profitSign = profit >= 0 ? '+' : '';

        listHtml += `
            <li class="list-group-item">
                <div class="d-flex justify-content-between align-items-center">
                    <span>${yearKey}</span>
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

/**
 * Renders a bar chart showing monthly profit and loss.
 * @param {object} monthlyData - An object with month keys and profit/sales data.
 */
function renderProfitLossChart(monthlyData) {
    const chartCanvas = document.getElementById('profitLossChart');
    const noDataEl = document.getElementById('noChartDataMessage');

    if (!chartCanvas || !noDataEl) {
        // This can happen if the user is not on the 'saled' page. It's not an error.
        return;
    }

    if (Object.keys(monthlyData).length < 1) {
        chartCanvas.style.display = 'none';
        noDataEl.style.display = 'block';
        noDataEl.textContent = 'No sales data available to generate a chart.';
        if (profitLossChart) {
            profitLossChart.destroy();
            profitLossChart = null;
        }
        return;
    }

    chartCanvas.style.display = 'block';
    noDataEl.style.display = 'none';

    const sortedMonths = Object.keys(monthlyData).sort();

    const labels = sortedMonths.map(monthKey => {
        const [year, month] = monthKey.split('-');
        return new Date(year, month - 1, 1).toLocaleString('default', { month: 'short', year: 'numeric' });
    });

    const salesData = sortedMonths.map(monthKey => monthlyData[monthKey].sales);
    const profitData = sortedMonths.map(monthKey => {
        const profit = monthlyData[monthKey].profit;
        return profit > 0 ? profit : 0;
    });
    const lossData = sortedMonths.map(monthKey => {
        const profit = monthlyData[monthKey].profit;
        return profit < 0 ? -profit : 0; // Store as a positive number for bar height
    });

    const ctx = chartCanvas.getContext('2d');
    if (profitLossChart) {
        profitLossChart.destroy();
    }

    profitLossChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Total Sales',
                    data: salesData,
                    backgroundColor: 'rgba(13, 110, 253, 0.6)',
                    borderColor: 'rgba(13, 110, 253, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Profit',
                    data: profitData,
                    backgroundColor: 'rgba(25, 135, 84, 0.6)',
                    borderColor: 'rgba(25, 135, 84, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Loss',
                    data: lossData,
                    backgroundColor: 'rgba(220, 53, 69, 0.6)',
                    borderColor: 'rgba(220, 53, 69, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Amount (₹)' } },
                x: { title: { display: true, text: 'Month' } }
            },
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: {
                    callbacks: {
                        label: context => {
                            let label = context.dataset.label || '';
                            let value = context.parsed.y;
                            if (label === 'Loss' && value !== 0) {
                                return `${label}: -₹${value.toFixed(2)}`;
                            }
                            return `${label}: ₹${value.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Filters and renders the sold records table based on the selected filter.
 * @param {string} [filter=currentSoldFilter] - The filter to apply ('all', 'profitable', 'loss').
 */
function updateSoldRecordsView(filter = currentSoldFilter) {
    currentSoldFilter = filter;

    document.querySelectorAll('#soldRecordsFilterButtons button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    const clearBtn = document.getElementById('clearSoldFiltersBtn');

    // Show clear button if any local filter is active
    if (clearBtn) {
        clearBtn.style.display = (filter !== 'all') ? 'inline-block' : 'none';
    }

    const tableBody = document.getElementById('sheepSaledTableBody');

    // Start with the master list of sold records, unaffected by global filters
    const recordsToProcess = [...masterSoldRecords];

    // Get local month and year filters for the sold records card
    const localMonthFilter = document.getElementById('soldMonthFilter')?.value || 'all';
    const localYearFilter = document.getElementById('soldYearFilter')?.value || 'all';

    const filteredRecords = recordsToProcess.filter(record => {
        // Ensure record.saleDate exists and is valid
        if (!record.saleDate) return false;
        const saleDate = new Date(record.saleDate + 'T00:00:00'); // Ensure date is parsed correctly
        if (isNaN(saleDate.getTime())) return false; // Skip records with invalid sale dates

        // Apply local month and year filters from the sold records card
        const monthMatch = (localMonthFilter === 'all') || ((saleDate.getMonth() + 1).toString() === localMonthFilter);
        const yearMatch = (localYearFilter === 'all') || (saleDate.getFullYear().toString() === localYearFilter);

        if (!monthMatch || !yearMatch) return false; // If month or year doesn't match, exclude

        if (filter === 'all') {
            return true;
        }
        // Profitability filter logic remains the same
        const buyingPrice = parseFloat(record.buyingPrice) || 0;
        const salePrice = parseFloat(record.salePrice) || 0;
        const treatmentCosts = (record.treatments && typeof record.treatments === 'object')
            ? Object.values(record.treatments).reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0)
            : 0;
        const totalCost = buyingPrice + treatmentCosts;
        const profit = salePrice - totalCost;

        if (filter === 'profitable' && profit < 0) return false;
        if (filter === 'loss' && profit >= 0) return false;

        return true; // Record passes all filters
    });

    // Sort by sale date, newest first, to show the latest sales at the top.
    filteredRecords.sort((a, b) => new Date(b.saleDate) - new Date(a.saleDate));

    const rowsHtml = filteredRecords.map(renderSoldRow).join('');
    tableBody.innerHTML = rowsHtml || `<tr><td colspan="5" class="text-center p-4 text-muted">No sold records match the filter criteria.</td></tr>`;
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
        <td class="text-nowrap">${formatDate(record.dateRecorded)}</td>
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
        <td class="text-nowrap">${followUpDateHtml}</td>
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
        <td class="text-nowrap">${followUpDateHtml}</td>
        <td>
            <button class="btn btn-sm btn-info js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}"><i class="fas fa-notes-medical"></i> Manage</button>
            <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}"><i class="fas fa-edit"></i></button>
        </td>
    </tr>`;
}

function renderWeeklyRow(record) {
    const lastActivityDateStr = record.lastActivityDate ? formatDate(record.lastActivityDate.toISOString().split('T')[0]) : 'N/A';
    let weeklyStatusBadge;
    let rowClass = '';
    let actionButtons = '';

    if (record.isChecked) {
        weeklyStatusBadge = '<span class="badge bg-success">Checked</span>';
        actionButtons = `<button class="btn btn-sm btn-info js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Log New Treatment"><i class="fas fa-notes-medical"></i> Manage</button>
                         <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}" title="Edit Record"><i class="fas fa-edit"></i></button>`;
    } else {
        rowClass = 'table-warning-light'; // Highlight row for needs check
        let daysOverdueText = '';
        if (record.daysSinceLastCheck !== null && record.daysSinceLastCheck > 0) {
            daysOverdueText = ` (${record.daysSinceLastCheck} day${record.daysSinceLastCheck > 1 ? 's' : ''} overdue)`;
        } else if (record.daysSinceLastCheck === null) {
            daysOverdueText = ' (No activity recorded)';
        }
        weeklyStatusBadge = `<span class="badge bg-warning text-dark">Needs Check${daysOverdueText}</span>`;
        actionButtons = `<button class="btn btn-sm btn-success js-mark-checked" data-record-id="${record.id}" title="Mark as Checked Today"><i class="fas fa-check"></i> Mark Checked</button>
                         <button class="btn btn-sm btn-info js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Log New Treatment"><i class="fas fa-notes-medical"></i> Manage</button>
                         <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}" title="Edit Record"><i class="fas fa-edit"></i></button>`;
    }

    return `<tr class="${rowClass}">
        <td><strong>${record.sheepId}</strong></td>
        <td><span class="${getStatusClass(record.healthStatus)}">${record.healthStatus}</span></td>
        <td class="text-nowrap">${lastActivityDateStr}</td>
        <td>${weeklyStatusBadge}</td>
        <td>${actionButtons}</td>
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
        // Show reminders for anything due within the next 30 days or that is overdue
        if (dewormingDayDiff !== null && dewormingDayDiff <= 30) {
            let status = '', message = '';
            if (dewormingDayDiff < 0) {
                status = 'Overdue';
                message = `Deworming is overdue by ${-dewormingDayDiff} day(s).`;
            } else if (dewormingDayDiff === 0) {
                status = 'Due Today';
                message = 'Deworming is due today.';
            } else {
                status = 'Upcoming';
                message = `Deworming due in ${dewormingDayDiff} day(s).`;
            }
            reminders.push({ sheepId: record.sheepId, recordId: record.id, message, status });
        }

        let vaxDayDiff;
        if (record.manualVaccinationDueDate) {
            const dueDate = new Date(record.manualVaccinationDueDate + 'T00:00:00');
            if (!isNaN(dueDate.getTime())) {
                vaxDayDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
            } else {
                vaxDayDiff = null;
            }
        } else {
            vaxDayDiff = getDayDiffFromLastDate(record.lastVaccinationDate, 365);
        }
        // Show reminders for anything due within the next 30 days or that is overdue
        if (vaxDayDiff !== null && vaxDayDiff <= 30) {
            let status = '', message = '';
            if (vaxDayDiff < 0) {
                status = 'Overdue';
                message = `Vaccination is overdue by ${-vaxDayDiff} day(s).`;
            } else if (vaxDayDiff === 0) {
                status = 'Due Today';
                message = 'Vaccination is due today.';
            } else {
                status = 'Upcoming';
                message = `Vaccination due in ${vaxDayDiff} day(s).`;
            }
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let recordsWithStatus = allRecords.map(record => {
        const lastActivityDate = gatherAllActivityDates(record);
        let isChecked = false;
        let daysSinceLastCheck = null;

        if (lastActivityDate) {
            isChecked = lastActivityDate >= sevenDaysAgo;
            daysSinceLastCheck = Math.floor((today.getTime() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24));
        }

        return { ...record, lastActivityDate, isChecked, daysSinceLastCheck };
    });

    let filteredRecords = recordsWithStatus.filter(r => {
        if (filter === 'all') return true;
        if (filter === 'checked') return r.isChecked;
        if (filter === 'needs_check') return !r.isChecked;
        // Also filter out records with no activity date if 'needs_check' is selected
        if (filter === 'needs_check' && !r.lastActivityDate) return true;
        return false;
    });

    // Sort: needs_check first, then by lastActivityDate (oldest first for needs_check, newest for checked), then by sheepId
    filteredRecords.sort((a, b) => {
        // Primary sort: Needs check first
        if (!a.isChecked && b.isChecked) return -1; // a needs check, b is checked -> a comes first
        if (a.isChecked && !b.isChecked) return 1;  // a is checked, b needs check -> b comes first

        // Secondary sort (only if both have same isChecked status):
        if (!a.isChecked && !b.isChecked) { // Both need check
            // Handle null lastActivityDate (never checked)
            if (a.lastActivityDate === null && b.lastActivityDate !== null) return -1;
            if (a.lastActivityDate !== null && b.lastActivityDate === null) return 1;
            if (a.lastActivityDate === null && b.lastActivityDate === null) return a.sheepId.localeCompare(b.sheepId, undefined, { numeric: true }); // Both null, fallback to ID

            // Sort by lastActivityDate (oldest first for needs_check)
            return a.lastActivityDate.getTime() - b.lastActivityDate.getTime();
        }

        if (a.isChecked && b.isChecked) { // Both are checked
            // Sort by lastActivityDate (newest first for checked, to show most recently checked at top of 'checked' list)
            return b.lastActivityDate.getTime() - a.lastActivityDate.getTime();
        }

        // Tertiary sort (fallback for all other cases): by sheepId
        return a.sheepId.localeCompare(b.sheepId, undefined, { numeric: true });
    });

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

    let overdueCount = 0;
    let upcomingCount = 0;

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
    
    // Calculate counts for all sheep regardless of current filter
    sortedRecords.forEach(record => {
        const dewormStatus = getScheduleStatus(record.lastDewormingDate, 30, null);
        const vaxStatus = getScheduleStatus(record.lastVaccinationDate, 365, record.manualVaccinationDueDate);

        if (dewormStatus.isOverdue || vaxStatus.isOverdue) {
            overdueCount++;
        }
        if ((dewormStatus.isUpcoming && !dewormStatus.isOverdue) || (vaxStatus.isUpcoming && !vaxStatus.isOverdue)) {
            upcomingCount++;
        }
    });

    // Update the counts on the buttons
    updateElement('scheduleOverdueCount', overdueCount);
    updateElement('scheduleUpcomingCount', upcomingCount);

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
    } else if (dayDiff <= 30) { // Changed from 24 to 30 for "Upcoming (30 Days)"
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

/**
 * Gathers all relevant activity dates for a sheep record and returns the latest one.
 * Includes initial record date, weight entries, and treatment dates.
 * @param {object} record - The sheep record object.
 * @returns {Date | null} The latest activity date as a Date object, or null if no valid dates found.
 */
function gatherAllActivityDates(record) {
    let dates = [];
    if (record.dateRecorded) dates.push(new Date(record.dateRecorded + 'T00:00:00'));
    if (record.weights) {
        Object.values(record.weights).forEach(w => { if (w.date) dates.push(new Date(w.date + 'T00:00:00')); });
    }
    if (record.treatments) {
        Object.values(record.treatments).forEach(t => { if (t.treatmentDate) dates.push(new Date(t.treatmentDate + 'T00:00:00')); });
    }
    // Filter out invalid dates and sort to get the latest
    const validDates = dates.filter(d => !isNaN(d.getTime()));
    if (validDates.length === 0) return null;
    return new Date(Math.max(...validDates));
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
    let tableHtml = `<table class="table table-sm table-striped"><thead><tr><th>Date</th><th>Weight (kg)</th><th class="text-center">Period Gain (Weekly)</th><th>Source</th><th>Actions</th></tr></thead><tbody>`;
    weightPoints.forEach((p, index) => {
        let weeklyGainHtml = '<td class="text-center">-</td>'; // Default for the first entry

        if (index > 0) {
            const prevPoint = weightPoints[index - 1];
            const weightGain = p.weight - prevPoint.weight;
            const timeDiffDays = (p.date.getTime() - prevPoint.date.getTime()) / (1000 * 60 * 60 * 24);

            if (timeDiffDays > 0) {
                const weeklyGainKg = (weightGain / timeDiffDays) * 7;
                const gainClass = weeklyGainKg >= 0 ? 'text-success' : 'text-danger';
                const gainSign = weeklyGainKg >= 0 ? '+' : '';
                weeklyGainHtml = `<td class="text-center fw-bold ${gainClass}">${gainSign}${weeklyGainKg.toFixed(3)} kg/wk</td>`;
            }
        }

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
        tableHtml += `<tr><td>${formatDate(p.date.toISOString().split('T')[0])}</td><td>${p.weight.toFixed(1)} kg</td>${weeklyGainHtml}<td>${sourceText}</td><td>${actions}</td></tr>`;
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

    let awg = 0; // Average Weekly Gain
    if (timeDiffDays > 0) {
        const adg = weightGain / timeDiffDays; // in kg/day
        awg = adg * 7; // in kg/week
    }

    container.innerHTML = `
        <h5 class="card-title mb-3">Weight Statistics</h5>
        <div class="mb-3">
            <p class="mb-0 text-muted">Average Weekly Gain (AWG)</p>
            <h3 class="text-success">${awg.toFixed(3)} kg/week</h3>
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
    const healthyAndRecovering = allRecords.filter(r => r.healthStatus === 'Healthy' || r.healthStatus === 'Recovering').length;
    const corentin = allRecords.filter(r => r.healthStatus === 'Corentin').length;
    const treatment = allRecords.filter(r => r.healthStatus === 'Under Treatment').length;
    const pregnant = allRecords.filter(r => r.healthStatus === 'Pregnant').length;
    const maleCount = allRecords.filter(r => r.gender === 'Male').length;
    const femaleCount = allRecords.filter(r => r.gender === 'Female').length;
    const totalValue = allRecords.reduce((sum, record) => sum + (parseFloat(record.buyingPrice) || 0), 0);

    updateElement('totalCount', total);
    updateElement('healthyCount', healthyAndRecovering);
    updateElement('sickCount', corentin);
    updateElement('treatmentCount', treatment);
    updateElement('pregnantCount', pregnant);
    updateElement('maleCount', maleCount);
    updateElement('femaleCount', femaleCount);
    updateElement('flockValue', `₹${totalValue.toFixed(2)}`);

    // --- Pie Chart & Dashboard Summary Updates ---

    // 1. Update Health Status Pie Chart
    const healthyCount = allRecords.filter(r => r.healthStatus === 'Healthy').length;
    const recoveringCount = allRecords.filter(r => r.healthStatus === 'Recovering').length;
    const healthChartData = {
        healthy: healthyCount,
        recovering: recoveringCount,
        underTreatment: treatment,
        corentin: corentin,
        pregnant: pregnant
    };
    renderHealthStatusPieChart(healthChartData);

    // 2. Update Dashboard's Monthly Sales Summary
    const monthlyTotals = {};
    masterSoldRecords.forEach(record => { // Changed from soldRecords to masterSoldRecords
        try {
            if (record.saleDate && record.salePrice != null) {
                const saleDate = new Date(record.saleDate + 'T00:00:00');
                if (!isNaN(saleDate.getTime())) {
                    const monthKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`;
                    if (!monthlyTotals[monthKey]) monthlyTotals[monthKey] = { sales: 0, profit: 0 };
                    const salePrice = parseFloat(record.salePrice) || 0;
                    const buyingPrice = parseFloat(record.buyingPrice) || 0;
                    const treatmentCosts = (record.treatments && typeof record.treatments === 'object') ? Object.values(record.treatments).reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0) : 0;
                    const totalCost = buyingPrice + treatmentCosts;
                    const profit = salePrice - totalCost;
                    monthlyTotals[monthKey].sales += salePrice;
                    monthlyTotals[monthKey].profit += profit;
                }
            }
        } catch (e) { /* ignore records that fail to process */ }
    });
    renderMonthlySalesSummary(monthlyTotals, 'newest');
}

/**
 * Renders the health status pie chart on the main dashboard.
 * @param {object} healthData - An object with counts for each health status.
 */
function renderHealthStatusPieChart(healthData) {
    const ctx = document.getElementById('healthStatusPieChart')?.getContext('2d');
    const legendContainer = document.getElementById('pieChartLegend');
    if (!ctx || !legendContainer) return;

    if (healthStatusPieChartInstance) healthStatusPieChartInstance.destroy();

    const labels = ['Healthy', 'Recovering', 'Under Treatment', 'Corentin', 'Pregnant'];
    const data = [healthData.healthy, healthData.recovering, healthData.underTreatment, healthData.corentin, healthData.pregnant];
    const backgroundColors = ['#28a745', '#17a2b8', '#ffc107', '#dc3545', '#6f42c1'];

    const filteredLabels = [], filteredData = [], filteredColors = [];
    data.forEach((value, index) => {
        if (value > 0) {
            filteredLabels.push(labels[index]);
            filteredData.push(value);
            filteredColors.push(backgroundColors[index]);
        }
    });

    if (filteredData.length === 0) {
        legendContainer.innerHTML = '<p class="text-muted text-center">No active sheep with health data to display.</p>';
        if (ctx.canvas) ctx.canvas.style.display = 'none';
        return;
    }
    if (ctx.canvas) ctx.canvas.style.display = 'block';

    healthStatusPieChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: filteredLabels,
            datasets: [{
                data: filteredData,
                backgroundColor: filteredColors,
                borderWidth: 0 // Removes the white separator lines
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { backgroundColor: '#333', titleFont: { size: 14 }, bodyFont: { size: 12 }, padding: 10, cornerRadius: 4, bodySpacing: 5 } }
        }
    });

    legendContainer.innerHTML = filteredLabels.map((label, index) => `<span class="me-3"><i class="fas fa-circle fa-xs" style="color: ${filteredColors[index]};"></i> ${label}</span>`).join('');
}

function calculateADG(record) {
    const allWeightPoints = gatherAllWeightData(record);
    if (allWeightPoints.length < 2) {
        return null;
    }

    const firstPoint = allWeightPoints[0];
    const lastPoint = allWeightPoints[allWeightPoints.length - 1];

    const weightGain = lastPoint.weight - firstPoint.weight;
    const timeDiffDays = (lastPoint.date.getTime() - firstPoint.date.getTime()) / (1000 * 60 * 60 * 24);

    if (timeDiffDays > 0) {
        return weightGain / timeDiffDays; // in kg/day
    }
    return null;
}

/**
 * Fetches, calculates, and displays the growth analytics dashboard.
 * This is the main entry point when the Growth section is shown.
 */
function displayGrowthAnalytics() {
    const tableBody = document.getElementById('growthAnalyticsTableBody');
    if (!tableBody) {
        return;
    }

    // 1. Calculate raw growth data from master records
    state.growthAnalyticsData = allRecords.map(record => {
        const allWeightPoints = gatherAllWeightData(record);
        if (allWeightPoints.length < 2) {
            return { id: record.id, sheepId: record.sheepId, gender: record.gender, breed: record.breed, hasData: false };
        }

        const firstPoint = allWeightPoints[0];
        const lastPoint = allWeightPoints[allWeightPoints.length - 1];
        const weightGain = lastPoint.weight - firstPoint.weight;
        const timeDiffDays = Math.max(1, (lastPoint.date.getTime() - firstPoint.date.getTime()) / (1000 * 60 * 60 * 24));
        const adg = weightGain / timeDiffDays;

        return {
            id: record.id,
            sheepId: record.sheepId,
            gender: record.gender,
            breed: record.breed,
            hasData: true,
            netGain: weightGain,
            durationDays: timeDiffDays,
            startWeight: firstPoint.weight,
            latestWeight: lastPoint.weight,
            adg: adg // in kg/day
        };
    });

    // 2. Populate Breed Filter Dropdown
    const breedFilter = document.getElementById('growthBreedFilter');
    const breeds = [...new Set(state.growthAnalyticsData.map(s => s.breed).filter(Boolean))].sort();
    breedFilter.innerHTML = '<option value="all">All Breeds</option>';
    breeds.forEach(breed => {
        const option = document.createElement('option');
        option.value = breed;
        option.textContent = breed;
        breedFilter.appendChild(option);
    });

    // 3. Reset filters to their default state
    document.getElementById('growthGenderFilter').value = 'all';
    breedFilter.value = 'all';
    const searchInput = document.querySelector('input[data-table-body-id="growthAnalyticsTableBody"]');
    if (searchInput) searchInput.value = '';
    state.currentGrowthFilters = { gender: 'all', breed: 'all', searchTerm: '' };

    // 4. Perform initial render
    applyGrowthFiltersAndRender();
}

/**
 * Applies all active filters to the growth analytics data and re-renders the table.
 * This is the central function for any UI update on the growth table.
 */
function applyGrowthFiltersAndRender() {
    if (!state.growthAnalyticsData) return;

    // Filter the data
    let filteredData = state.growthAnalyticsData.filter(sheep => {
        const { gender, breed, searchTerm } = state.currentGrowthFilters;
        const searchMatch = searchTerm ? sheep.sheepId.toLowerCase().includes(searchTerm) : true;
        const genderMatch = gender === 'all' || sheep.gender === gender;
        const breedMatch = breed === 'all' || sheep.breed === breed;
        return searchMatch && genderMatch && breedMatch;
    });

    // Sort the filtered data
    const { column, direction } = growthAnalyticsSort;
    filteredData.sort((a, b) => {
        if (!a.hasData && !b.hasData) return 0;
        if (!a.hasData) return 1;
        if (!b.hasData) return -1;

        let valA = a[column];
        let valB = b[column];

        if (typeof valA === 'string') {
            return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return direction === 'asc' ? (valA || -Infinity) - (valB || -Infinity) : (valB || -Infinity) - (valA || -Infinity);
        }
    });

    renderGrowthAnalyticsTable(filteredData);
}

/**
 * Renders the HTML for the growth analytics table from a given dataset.
 * @param {Array} data - The pre-filtered and pre-sorted array of sheep growth data.
 */
function renderGrowthAnalyticsTable(data) {
    const tableBody = document.getElementById('growthAnalyticsTableBody');
    if (!tableBody) return;

    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center p-4">No records match the current filters.</td></tr>';
        return;
    }

    const rowsHtml = data.map((stat, index) => {
        if (!stat.hasData) {
            return `<tr>
                        <td class="text-center text-muted align-middle">--</td>
                        <td>
                            <a href="#" class="fw-bold profile-link" data-sheep-id="${stat.id}">${stat.sheepId}</a>
                            <div class="small text-muted">${stat.breed || 'N/A'}</div>
                        </td>
                        <td colspan="3" class="text-center text-muted">Not enough weight data</td>
                    </tr>`;
        }

        const gainClass = stat.netGain >= 0 ? 'text-success' : 'text-danger';
        const netGainSign = stat.netGain >= 0 ? '+' : '';
        const rank = index + 1;
        let rankClass = 'text-dark';
        if (rank === 1) rankClass = 'text-success fw-bold';
        if (rank === 2) rankClass = 'text-primary fw-bold';
        if (rank === 3) rankClass = 'text-info fw-bold';

        // Calculate and format weekly gain for better readability
        const weeklyGainKg = stat.adg * 7;
        const weeklyGainClass = weeklyGainKg >= 0 ? 'text-success' : 'text-danger';
        const weeklyGainSign = weeklyGainKg >= 0 ? '+' : '';
        let weeklyGainValue;
        let weeklyGainUnit;

        if (Math.abs(weeklyGainKg) >= 1.0) {
            weeklyGainValue = weeklyGainKg.toFixed(2);
            weeklyGainUnit = 'kg';
        } else {
            weeklyGainValue = (weeklyGainKg * 1000).toFixed(0);
            weeklyGainUnit = 'g';
        }

        return `<tr>
                    <td class="text-center align-middle"><h5 class="mb-0 ${rankClass}">${rank}</h5></td>
                    <td class="align-middle">
                        <div class="d-flex align-items-center">
                            <div class="me-3"><i class="fas fa-sheep fa-2x text-muted"></i></div>
                            <div>
                                <a href="#" class="fw-bold text-dark text-decoration-none profile-link" data-sheep-id="${stat.id}">${stat.sheepId}</a>
                                <div class="small text-muted">${stat.gender || 'N/A'}, ${stat.breed || 'N/A'}</div>
                            </div>
                        </div>
                    </td>
                    <td class="align-middle text-center"><span class="badge bg-light text-dark fs-6">${(stat.startWeight || 0).toFixed(1)} kg &rarr; ${(stat.latestWeight || 0).toFixed(1)} kg</span><div class="small text-muted">over ${stat.durationDays} days</div></td>
                    <td class="align-middle text-center"><h5 class="mb-0 fw-bold ${gainClass}">${netGainSign}${stat.netGain.toFixed(1)} kg</h5></td>
                    <td class="align-middle text-center">
                        <h5 class="mb-0 fw-bold ${weeklyGainClass}">${weeklyGainSign}${weeklyGainValue} ${weeklyGainUnit}</h5>
                        <div class="small text-muted">per week</div>
                    </td>
                </tr>`;
    }).join('');

    tableBody.innerHTML = rowsHtml;

    // Update sort icons in the header
    const tableHead = document.querySelector('#growthAnalyticsTable thead');
    if (tableHead) {
        tableHead.querySelectorAll('th.sortable').forEach(th => {
            th.classList.remove('active');
            th.querySelector('.sort-icon').innerHTML = '';
        });
        const activeTh = tableHead.querySelector(`th[data-sort="${growthAnalyticsSort.column}"]`);
        if (activeTh) {
            activeTh.classList.add('active');
            const iconEl = activeTh.querySelector('.sort-icon');
            if (iconEl) {
                iconEl.innerHTML = growthAnalyticsSort.direction === 'asc' ? ' <i class="fas fa-sort-up"></i>' : ' <i class="fas fa-sort-down"></i>';
            }
        }
    }
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
            treatmentLogTbody.innerHTML = treatments.map(([id, t]) => {
                const costHtml = t.cost ? `₹${parseFloat(t.cost).toFixed(2)}` : 'N/A';
                const typeHtml = t.treatmentType || t.type || 'General'; // Backward compatibility for 'type'
                return `
                <tr>
                    <td>${formatDate(t.treatmentDate)}</td>
                    <td>${typeHtml}</td>
                    <td>${costHtml}</td>
                    <td>${t.symptoms || ''}</td>
                    <td>${t.medication || ''}</td>
                    <td>${t.dosage || ''}</td>
                    <td>${t.treatmentNotes || ''}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary js-edit-treatment" data-record-id="${recordId}" data-entry-id="${id}" title="Edit Entry"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-outline-danger js-delete-treatment" data-record-id="${recordId}" data-entry-id="${id}" title="Delete Entry"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');
        } else {
            treatmentLogTbody.innerHTML = '<tr><td colspan="8" class="text-center">No treatments logged.</td></tr>';
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
    const selectedCheckboxes = document.querySelectorAll('#scheduleTableBody .schedule-checkbox:checked');
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
            option.dataset.breed = record.breed || 'N/A';
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
            option.dataset.breed = record.breed || 'N/A';
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
            option.dataset.breed = record.breed || 'N/A';
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
    renderProfileWeightTabContent(record);
    renderProfileTreatmentTabContent(record);
    updateProfileNavButtons();
}

/**
 * Renders the content for the "Growth & Weight" tab on the profile page.
 * This includes the stat cards, the weight chart, and the weight log table.
 * @param {object} record - The full sheep record object.
 */
function renderProfileWeightTabContent(record) {
    const chartContainer = document.getElementById('profileWeightChartContainer');
    const tableContainer = document.getElementById('profileWeightTableContainer');

    // Clear previous content to prevent artifacts
    chartContainer.innerHTML = '<canvas id="profileWeightChart"></canvas>';
    tableContainer.innerHTML = '';

    const startDate = new Date(record.dateRecorded + 'T00:00:00');
    if (isNaN(startDate.getTime())) {
        chartContainer.innerHTML = '<div class="alert alert-warning">Cannot display weight chart due to invalid start date.</div>';
        renderProfileWeightStats([]); // Reset stats to N/A
        return;
    }

    const allWeightPoints = gatherAllWeightData(record);
    
    // Populate the four stat cards at the top of the tab
    renderProfileWeightStats(allWeightPoints);

    // Render the detailed weight log table
    renderWeightDataTable(allWeightPoints, record.id, 'profileWeightTableContainer');

    // Prepare data for the chart
    const chartPoints = allWeightPoints.map(dp => ({ x: (dp.date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 7), y: dp.weight }));

    if (chartPoints.length < 1) {
        chartContainer.innerHTML = '<div class="alert alert-info text-center h-100 d-flex align-items-center justify-content-center">No weight data to display.</div>';
        if (profileWeightChart) { profileWeightChart.destroy(); profileWeightChart = null; }
        return;
    }
    
    const ctx = document.getElementById('profileWeightChart').getContext('2d');
    if (profileWeightChart) { profileWeightChart.destroy(); }

    profileWeightChart = new Chart(ctx, {
        type: 'line',
        data: { 
            datasets: [{ 
                label: `Weight (kg) for ${record.sheepId}`, 
                data: chartPoints, 
                borderColor: '#0d6efd', 
                backgroundColor: 'rgba(13, 110, 253, 0.1)', 
                fill: true, 
                tension: 0.1, 
                pointRadius: 5, 
                pointHoverRadius: 7 
            }] 
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Weeks Since Record Start Date' }, min: 0 },
                y: { title: { display: true, text: 'Weight (kg)' } }
            },
            plugins: { tooltip: { callbacks: {
                title: context => `Week ${context[0].raw.x.toFixed(1)}`,
                label: context => `Weight: ${context.raw.y} kg`
            }}}
        }
    });
}

/**
 * Renders the content for the "Treatment History" tab on the profile page.
 * @param {object} record - The full sheep record object.
 */
function renderProfileTreatmentTabContent(record) {
    const tbody = document.getElementById('profileTreatmentHistoryTbody');
    const treatments = record.treatments ? Object.values(record.treatments).sort((a, b) => new Date(b.treatmentDate) - new Date(a.treatmentDate)) : [];

    if (treatments.length > 0) {
        tbody.innerHTML = treatments.map(entry => {
            const costHtml = entry.cost ? `₹${parseFloat(entry.cost).toFixed(2)}` : 'N/A';
            const typeHtml = entry.type || entry.treatmentType || 'General';
            return `<tr>
                <td>${formatDate(entry.treatmentDate)}</td>
                <td>${typeHtml}</td>
                <td>${costHtml}</td>
                <td>${entry.symptoms || ''}</td>
                <td>${entry.medication || ''}</td>
                <td>${entry.dosage || ''}</td>
                <td>${entry.treatmentNotes || ''}</td>
            </tr>`;
        }).join('');
    } else {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center p-4">No treatment history recorded.</td></tr>';
    }
}

/**
 * Calculates and populates the four main stat cards in the profile's weight tab.
 * @param {Array} allWeightPoints - A sorted array of weight data points.
 */
function renderProfileWeightStats(allWeightPoints) {
    const container = document.getElementById('profileWeightStatsContainer');
    if (!container) {
        console.error("UI Error: The element with ID 'profileWeightStatsContainer' was not found. The new growth summary cannot be displayed.");
        return;
    }

    if (allWeightPoints.length < 2) {
        let initialWeightHtml = '';
        if (allWeightPoints.length === 1) {
            const firstPoint = allWeightPoints[0];
            initialWeightHtml = `<p class="mb-0 mt-3"><strong>Initial Weight:</strong> ${firstPoint.weight.toFixed(1)} kg on ${formatDate(firstPoint.date.toISOString().split('T')[0])}</p>`;
        }
        container.innerHTML = `
            <div class="card-body text-center">
                <h5 class="card-title mb-2">Growth Summary</h5>
                <p class="card-text text-muted">At least two weight entries are needed to calculate growth statistics.</p>
                ${initialWeightHtml}
            </div>
        `;
        return;
    }

    const firstPoint = allWeightPoints[0];
    const lastPoint = allWeightPoints[allWeightPoints.length - 1];

    const weightGain = lastPoint.weight - firstPoint.weight;
    const timeDiffDays = Math.max(1, (lastPoint.date.getTime() - firstPoint.date.getTime()) / (1000 * 60 * 60 * 24));
    const awg = (weightGain / timeDiffDays) * 7; // in kg/week

    const gainClass = weightGain >= 0 ? 'text-success' : 'text-danger';
    const gainSign = weightGain >= 0 ? '+' : '';

    container.innerHTML = `
        <div class="card-body">
            <div class="row text-center align-items-center">
                <div class="col-md-6 col-lg-3 mb-3 mb-lg-0 border-end-lg">
                    <p class="mb-1 text-muted small text-uppercase">Avg. Weekly Gain</p>
                    <h4 class="fw-bold text-primary mb-0">${awg.toFixed(3)}</h4>
                    <span class="small text-muted">kg/week</span>
                </div>
                <div class="col-md-6 col-lg-3 mb-3 mb-lg-0 border-end-lg">
                    <p class="mb-1 text-muted small text-uppercase">Total Gain</p>
                    <h4 class="fw-bold ${gainClass} mb-0">${gainSign}${weightGain.toFixed(1)} kg</h4>
                    <span class="small text-muted">over ${timeDiffDays.toFixed(0)} days</span>
                </div>
                <div class="col-md-6 col-lg-3 mb-3 mb-md-0 border-end-lg">
                    <p class="mb-1 text-muted small text-uppercase">Start Weight</p>
                    <h4 class="fw-bold mb-0">${firstPoint.weight.toFixed(1)} kg</h4>
                    <span class="small text-muted">${formatDate(firstPoint.date.toISOString().split('T')[0])}</span>
                </div>
                <div class="col-md-6 col-lg-3">
                    <p class="mb-1 text-muted small text-uppercase">Latest Weight</p>
                    <h4 class="fw-bold mb-0">${lastPoint.weight.toFixed(1)} kg</h4>
                    <span class="small text-muted">${formatDate(lastPoint.date.toISOString().split('T')[0])}</span>
                </div>
            </div>
        </div>
    `;
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

/**
 * Filters a table's rows based on a search term.
 * Hides rows that do not contain the search term in any of their cells.
 * @param {HTMLInputElement} inputElement The input element containing the search term.
 * @param {string} tableBodyId The ID of the tbody element to filter.
 */
function filterTable(inputElement, tableBodyId) {
    const searchTerm = inputElement.value.toLowerCase();
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll('tr');
    rows.forEach(row => {
        // Ignore placeholder rows (e.g., "No records found")
        if (row.cells.length === 1 && row.cells[0].colSpan > 1) {
            return;
        }

        if (row.cells.length > 0) {
            const rowText = row.textContent.toLowerCase();
            const isVisible = rowText.includes(searchTerm);
            row.style.display = isVisible ? '' : 'none';
        }
    });
}

function filterProfileSelector() {
    const searchTerm = document.getElementById('profileSearchInput').value.toLowerCase();
    const selector = document.getElementById('profileSheepSelector');

    for (const option of selector.options) {
        if (option.disabled) continue;
        const optionText = option.textContent.toLowerCase();
        const breed = (option.dataset.breed || '').toLowerCase();
        const matchesSearch = optionText.includes(searchTerm) || breed.includes(searchTerm);
        option.style.display = matchesSearch ? '' : 'none';
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
        else if (target.closest('.js-mark-checked')) markSheepAsChecked(recordId);
        
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
    addSafeEventListener('weeklyFilterButtons', 'click', e => { if (e.target.matches('button')) updateWeeklyTrackingView(e.target.dataset.filter); });

    mainApp.addEventListener('keyup', e => {
        if (e.target.matches('input[data-table-body-id]')) {
            filterTable(e.target, e.target.dataset.tableBodyId);
            if (e.target.dataset.tableBodyId === 'scheduleTableBody') {
                updateBatchLogUI();
            }
        } else if (e.target.matches('#profileSearchInput')) {
            filterProfileSelector();
        }
    });

    // Event delegation for sold records filters
    mainApp.addEventListener('click', e => {
        if (e.target.matches('#soldRecordsFilterButtons button')) {
            updateSoldRecordsView(e.target.dataset.filter);
        } else if (e.target.matches('#clearSoldFiltersBtn')) {
            const monthFilter = document.getElementById('soldMonthFilter');
            if(monthFilter) monthFilter.value = 'all';
            const yearFilter = document.getElementById('soldYearFilter');
            if(yearFilter) yearFilter.value = 'all';
            updateSoldRecordsView('all');
        } else if (e.target.closest('#monthlySalesSort button')) {
            const sortBtn = e.target.closest('button');
            if (sortBtn && sortBtn.dataset.sort) handleMonthlySummarySort(sortBtn.dataset.sort);
        }
    });

    mainApp.addEventListener('change', e => {
        if (e.target.matches('#soldMonthFilter') || e.target.matches('#soldYearFilter')) {
            updateSoldRecordsView();
        }
    });

    // --- Growth Analytics Listeners ---
    addSafeEventListener('growthGenderFilter', 'change', e => {
        state.currentGrowthFilters.gender = e.target.value;
        applyGrowthFiltersAndRender();
    });
    addSafeEventListener('growthBreedFilter', 'change', e => {
        state.currentGrowthFilters.breed = e.target.value;
        applyGrowthFiltersAndRender();
    });
    const growthSearchInput = document.querySelector('input[data-table-body-id="growthAnalyticsTableBody"]');
    if (growthSearchInput) {
        growthSearchInput.addEventListener('keyup', e => {
            state.currentGrowthFilters.searchTerm = e.target.value.toLowerCase();
            applyGrowthFiltersAndRender();
        });
    }

    addSafeEventListener('growthAnalyticsTable', 'click', e => {
        const th = e.target.closest('th.sortable');
        if (!th) return;

        const newColumn = th.dataset.sort;
        let newDirection = 'desc';

        if (growthAnalyticsSort.column === newColumn) {
            newDirection = growthAnalyticsSort.direction === 'desc' ? 'asc' : 'desc';
        }
        growthAnalyticsSort = { column: newColumn, direction: newDirection };
        applyGrowthFiltersAndRender();
    });
    // Global Year/Month Filter Listeners
    addSafeEventListener('globalYearFilter', 'change', applyFiltersAndRender);
    addSafeEventListener('globalMonthFilter', 'change', applyFiltersAndRender);
    addSafeEventListener('globalDateClearBtn', 'click', () => {
        document.getElementById('globalYearFilter').value = 'all';
        document.getElementById('globalMonthFilter').value = 'all';
        applyFiltersAndRender();
    });

    // --- Dynamic UI Listeners ---
    addSafeEventListener('scheduleTableBody', 'change', e => { if (e.target.matches('.schedule-checkbox')) updateBatchLogUI(); });
    addSafeEventListener('selectAllSchedule', 'change', e => {
        const isChecked = e.target.checked;
        document.querySelectorAll('#scheduleTableBody .schedule-checkbox').forEach(cb => {
            if (cb.closest('tr').style.display !== 'none') { cb.checked = isChecked; }
        });
        updateBatchLogUI();
    });
    addSafeEventListener('profileSheepSelector', 'change', e => { if (e.target.value) renderProfileForSheep(e.target.value); });
    addSafeEventListener('weightSheepSelector', 'change', e => { if (e.target.value) renderWeightChartForSheep(e.target.value); });
    addSafeEventListener('addWeightBtn', 'click', () => {
        const recordId = document.getElementById('weightSheepSelector')?.value;
        if (recordId) openWeightModal(recordId);
    });
}

function handleMonthlySummarySort(sortBy) {
    monthlySummarySort = sortBy; // Set the global state for the 'saled' page filter
    // Re-calculate totals from the master `soldRecords` list to ensure the summary is always based on the full dataset
    const monthlyTotals = {};
    masterSoldRecords.forEach(record => { // Changed from soldRecords to masterSoldRecords
        try {
            if (record.saleDate && record.salePrice != null) {
                const saleDate = new Date(record.saleDate + 'T00:00:00');
                if (!isNaN(saleDate.getTime())) {
                    const monthKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`;
                    
                    if (!monthlyTotals[monthKey]) {
                        monthlyTotals[monthKey] = { sales: 0, profit: 0 };
                    }

                    const salePrice = parseFloat(record.salePrice) || 0;
                    const buyingPrice = parseFloat(record.buyingPrice) || 0;
                    const treatmentCosts = record.treatments ? Object.values(record.treatments).reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0) : 0;
                    const totalCost = buyingPrice + treatmentCosts;
                    const profit = salePrice - totalCost;

                    monthlyTotals[monthKey].sales += salePrice;
                    monthlyTotals[monthKey].profit += profit;
                }
            }
        } catch (e) { /* ignore records that fail to process */ }
    });
    renderMonthlySalesSummary(monthlyTotals, sortBy);
}

function populateGlobalFilters() {
    const yearSelector = document.getElementById('globalYearFilter');
    const monthSelector = document.getElementById('globalMonthFilter');
    if (!yearSelector || !monthSelector) return;

    const allDates = [

        ...masterAllRecords.map(r => r.dateRecorded),
        ...masterSoldRecords.map(r => r.saleDate),
        ...masterArchivedRecords.map(r => r.archiveDate)
    ].filter(Boolean);

    if (allDates.length === 0) return;

    const uniqueYears = [...new Set(allDates.map(d => new Date(d + 'T00:00:00').getFullYear()))].sort((a, b) => b - a);

    const currentYear = yearSelector.value;

    yearSelector.innerHTML = '<option value="all">All Years</option>';
    uniqueYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelector.appendChild(option);
    });
    yearSelector.value = currentYear || 'all';

    const currentMonth = monthSelector.value;
    monthSelector.innerHTML = '<option value="all">All Months</option>';
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    for (let i = 0; i < 12; i++) {
        const option = document.createElement('option');
        option.value = i; // 0-11
        option.textContent = monthNames[i];
        monthSelector.appendChild(option);
    }
    monthSelector.value = currentMonth || 'all';
}

// New function for marking sheep as checked
function markSheepAsChecked(recordId) {
    if (confirm('Mark this sheep as checked today? This will update its last activity date by adding a new weight entry.')) {
        const today = new Date().toISOString().split('T')[0];
        const record = allRecords.find(r => r.id === recordId);
        if (record) {
            // Determine the latest weight to use for the new entry
            const allWeightPoints = gatherAllWeightData(record); // Re-use existing function to get all weight points
            const latestWeight = allWeightPoints.length > 0 ? allWeightPoints[allWeightPoints.length - 1].weight : (parseFloat(record.weight) || 0);

            const newWeightEntry = {
                date: today,
                weight: latestWeight,
                notes: 'Marked as checked via weekly tracking'
            };
            push(ref(db, `sheepHealthRecords/${recordId}/weights`), newWeightEntry)
                .catch(error => {
                    console.error("Error marking sheep as checked:", error);
                    alert("Failed to mark sheep as checked: " + error.message);
                });
        }
    }
}
