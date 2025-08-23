import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getDatabase, ref, onValue, push, update, remove, child, orderByChild, query } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js";

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
let editSheepModal, saleSheepModal, treatmentLogModal, weightEntryModal, batchTreatmentModal;
let healthStatusChart, weightChart, profileWeightChart;
let currentWeeklyFilter = 'all';
let currentScheduleFilter = 'all';

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
    ['home', 'records', 'treatment', 'saled', 'analytics', 'archived', 'schedule', 'weekly', 'weight', 'profile', 'corentin'].forEach(id => {
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
    if (!record.treatments) return 'none';

    const treatmentsWithFollowUp = Object.values(record.treatments)
        .filter(t => t.followUpDate)
        .sort((a, b) => new Date(b.followUpDate) - new Date(a.followUpDate));

    if (treatmentsWithFollowUp.length === 0) return 'none';

    const latestFollowUpDateStr = treatmentsWithFollowUp[0].followUpDate;
    const followUpDate = new Date(latestFollowUpDateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(followUpDate.getTime())) return 'none';

    if (followUpDate < today) {
        return 'overdue';
    } else { // Includes today and future dates
        return 'upcoming';
    }
}

function fetchAllRecords() {
    const recordsRef = ref(db, "sheepHealthRecords");
    onValue(recordsRef, snapshot => {
        let healthyHtml = '';
        let corentinRecords = [];
        let underTreatmentRecords = [];
        allRecords = [];

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const record = { id: child.key, ...child.val() };
                allRecords.push(record);
                const status = record.healthStatus;
                if (status === 'Healthy' || status === 'Recovering') {
                    healthyHtml += renderHealthyRow(record);
                } else if (status === 'Corentin') {
                    corentinRecords.push(record);
                } else if (status === 'Under Treatment') {
                    underTreatmentRecords.push(record);
                }
            });
        }

        const generateGroupedHtml = (records) => records.map(renderTreatmentRow).join('');
        const corentinHtml = generateGroupedHtml(corentinRecords);
        const treatmentHtml = generateGroupedHtml(underTreatmentRecords);

        document.getElementById('healthyRecordsTableBody').innerHTML = healthyHtml || `<tr><td colspan="7" class="text-center">No healthy records.</td></tr>`;
        document.getElementById('analyticsHealthyRecordsTableBody').innerHTML = healthyHtml || `<tr><td colspan="7" class="text-center">No healthy records.</td></tr>`;
        document.getElementById('corentinRecordsTableBody').innerHTML = corentinHtml || `<tr><td colspan="5" class="text-center">No 'Corentin' status records.</td></tr>`;
        document.getElementById('treatmentRecordsTableBody').innerHTML = treatmentHtml || `<tr><td colspan="5" class="text-center">No 'Under Treatment' records.</td></tr>`;

        updateAnalytics();
        updateGrowthAnalytics();
        updateScheduleView();
        updateWeeklyTrackingView();
        updateWeightTrackingView();
        updateProfileView();
        checkTreatmentFollowUps();
        checkPreventativeCareReminders();
    });
}

function fetchSoldRecords() {
    const recordsRef = ref(db, "sheepSaledRecords");
    const soldQuery = query(recordsRef, orderByChild("saleDate"));
    onValue(soldQuery, snapshot => {
        const tableBody = document.getElementById('sheepSaledTableBody');
        soldRecords = [];
        let rowsHtml = '';
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const record = { id: child.key, ...child.val() };
                soldRecords.push(record);
            });
            soldRecords.reverse(); // Show newest first
            rowsHtml = soldRecords.map(renderSoldRow).join('');
        }
        tableBody.innerHTML = rowsHtml || `<tr><td colspan="7" class="text-center">No sold records.</td></tr>`;
        updateProfileView();
    }, error => {
        console.error("Error fetching sold records:", error);
        document.getElementById('sheepSaledTableBody').innerHTML = `<tr><td colspan="7" class="text-center text-danger">Error loading sold records. Check browser console for details.</td></tr>`;
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

function renderSoldRow(record) {
    return `<tr>
        <td><strong>${record.sheepId}</strong></td>
        <td>${record.healthStatus}</td>
        <td>${formatDate(record.saleDate)}</td>
        <td>${record.salePrice || 'N/A'}</td>
        <td>${record.saleBuyer || 'N/A'}</td>
        <td>${record.saleNotes || ''}</td>
        <td><button class="btn btn-sm btn-outline-danger js-delete-sold-record" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Permanently Delete"><i class="fas fa-trash"></i></button></td>
    </tr>`;
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
        <td><span class="${getStatusClass(record.healthStatus)}">${record.healthStatus}</span></td>
        <td>${formatDate(record.dateRecorded)}</td>
        <td>${record.weight || 'N/A'}</td>
        <td>${record.temperature || 'N/A'}</td>
        <td>${record.notes || ''}</td>
        <td>
            <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}"><i class="fas fa-edit"></i></button>
            <button class="btn btn-sm btn-outline-success js-sale-record" data-record-id="${record.id}"><i class="fas fa-dollar-sign"></i> Sale</button>
            <button class="btn btn-sm btn-outline-danger js-delete-record" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Permanently Delete"><i class="fas fa-trash"></i></button>
            <button class="btn btn-sm btn-outline-secondary js-archive-record" data-record-id="${record.id}" title="Mark as Deceased/Archive"><i class="fas fa-archive"></i></button>
        </td>
    </tr>`;
}

function renderTreatmentRow(record) {
    let lastUpdate = 'N/A';
    let followUpIndicator = '';
    let rowClass = ''; // For highlighting the entire row

    if (record.treatments) {
        const treatments = Object.values(record.treatments).sort((a, b) => new Date(b.treatmentDate) - new Date(a.treatmentDate));
        if (treatments.length > 0) {
            const latestTreatment = treatments[0];
            lastUpdate = formatDate(latestTreatment.treatmentDate);

            if (latestTreatment.followUpDate) {
                const followUpDate = new Date(latestTreatment.followUpDate + 'T00:00:00');
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dayDiff = Math.ceil((followUpDate.getTime() - today.getTime()) / (1000 * 3600 * 24));

                if (dayDiff < 0) {
                    followUpIndicator = ` <span class="badge bg-danger" title="Follow-up was due on ${formatDate(latestTreatment.followUpDate)}">Overdue</span>`;
                    rowClass = 'table-danger-light';
                } else if (dayDiff === 0) {
                    followUpIndicator = ` <span class="badge bg-warning text-dark" title="Follow-up due today">Due Today</span>`;
                    rowClass = 'table-warning-light';
                } else {
                    followUpIndicator = ` <span class="badge bg-info" title="Follow-up due in ${dayDiff} day(s) on ${formatDate(latestTreatment.followUpDate)}">Upcoming</span>`;
                    rowClass = 'table-info-light';
                }
            }
        }
    }
    return `<tr class="${rowClass}">
        <td><strong>${record.sheepId}</strong></td>
        <td><span class="${getStatusClass(record.healthStatus)}">${record.healthStatus}</span></td>
        <td>${formatDate(record.dateRecorded)}</td>
        <td>${lastUpdate}${followUpIndicator}</td>
        <td>
            <button class="btn btn-sm btn-info js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}"><i class="fas fa-notes-medical"></i> Manage</button>
            <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}"><i class="fas fa-edit"></i></button>
            <button class="btn btn-sm btn-outline-success js-sale-record" data-record-id="${record.id}"><i class="fas fa-dollar-sign"></i> Sale</button>
            <button class="btn btn-sm btn-outline-danger js-delete-record" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Permanently Delete"><i class="fas fa-trash"></i></button>
            <button class="btn btn-sm btn-outline-secondary js-archive-record" data-record-id="${record.id}" title="Mark as Deceased/Archive"><i class="fas fa-archive"></i></button>
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

function renderScheduleRow(record) {
    const dewormingStatus = getScheduleStatus(record.lastDewormingDate, 30, null);
    const vaccinationStatus = getScheduleStatus(record.lastVaccinationDate, 365, record.manualVaccinationDueDate);

    return `
        <tr>
            <td><input type="checkbox" class="form-check-input sheep-select-checkbox" data-id="${record.id}"></td>
            <td><strong>${record.sheepId}</strong></td>
            <td>${renderScheduleStatusBadge(dewormingStatus, record.lastDewormingDate)}</td>
            <td>${record.lastDewormingNotes || ''}</td>
            <td>${renderScheduleStatusBadge(vaccinationStatus, record.lastVaccinationDate)}</td>
            <td>${record.lastVaccinationNotes || ''}</td>
            <td>
                <button class="btn btn-sm btn-info js-manage-treatment" data-record-id="${record.id}" data-sheep-id="${record.sheepId}" title="Log New Treatment"><i class="fas fa-notes-medical"></i> Manage</button>
                <button class="btn btn-sm btn-outline-primary js-edit-record" data-record-id="${record.id}" title="Edit Record"><i class="fas fa-edit"></i></button>
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
        if (dewormingDayDiff !== null && dewormingDayDiff <= 30) {
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
        if (vaxDayDiff !== null && vaxDayDiff <= 30) {
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
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center">No sheep match the filter criteria.</td></tr>`;
    } else {
        tableBody.innerHTML = recordsToDisplay.map(renderScheduleRow).join('');
    }
    updateBatchLogUI();
}

function getScheduleStatus(lastDateStr, daysUntilDue, manualDueDateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dueDate;
    if (manualDueDateStr) {
        dueDate = new Date(manualDueDateStr + 'T00:00:00');
    } else if (lastDateStr) {
        const lastDate = new Date(lastDateStr + 'T00:00:00');
        dueDate = new Date(lastDate.getTime());
        dueDate.setDate(dueDate.getDate() + daysUntilDue);
    } else {
        return { text: 'No Record', className: 'secondary', dayDiff: Infinity, isOverdue: false, isUpcoming: false };
    }

    if (isNaN(dueDate.getTime())) {
        return { text: 'Invalid Date', className: 'secondary', dayDiff: Infinity, isOverdue: false, isUpcoming: false };
    }

    const timeDiff = dueDate.getTime() - today.getTime();
    const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

    let text = `Due ${formatDate(dueDate.toISOString().split('T')[0])}`;
    let className = 'success';
    let isOverdue = false;
    let isUpcoming = false;

    if (dayDiff < 0) {
        text = `Overdue by ${-dayDiff} day(s)`;
        className = 'danger';
        isOverdue = true;
        isUpcoming = true;
    } else if (dayDiff === 0) {
        text = 'Due Today';
        className = 'warning';
        isUpcoming = true;
    } else if (dayDiff <= 30) {
        text = `Due in ${dayDiff} day(s)`;
        className = (dayDiff <= 7) ? 'warning' : 'info';
        isUpcoming = true;
    }

    return { text, className, dayDiff, isOverdue, isUpcoming };
}

function renderScheduleStatusBadge(status, lastDate) {
    const tooltipContent = `Last Given: ${lastDate ? formatDate(lastDate) : 'N/A'}`;
    return `<span class="badge bg-${status.className}" data-bs-toggle="tooltip" title="${tooltipContent}">${status.text}</span>`;
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
    const isProfile = containerId.startsWith('profile');
    let tableHtml = `<table class="table table-sm table-striped"><thead><tr><th>Date</th><th>Weight (kg)</th><th>Source</th><th>Actions</th></tr></thead><tbody>`;
    weightPoints.forEach(p => {
        let sourceText = '';
        let actions = '';
        switch (p.source) {
            case 'initial':
                sourceText = '<span class="badge bg-primary">Initial Record</span>';
                actions = isProfile ? '' : `<button class="btn btn-sm btn-outline-primary js-edit-weight" data-record-id="${recordId}" data-entry-id="${p.id}" data-source="initial" title="Edit Initial Weight"><i class="fas fa-edit"></i></button>`;
                break;
            case 'log':
                sourceText = '<span class="badge bg-info">Logged Entry</span>';
                actions = isProfile ? '' : `<button class="btn btn-sm btn-outline-primary js-edit-weight" data-record-id="${recordId}" data-entry-id="${p.id}" data-source="log" title="Edit Entry"><i class="fas fa-edit"></i></button> <button class="btn btn-sm btn-outline-danger js-delete-weight" data-record-id="${recordId}" data-entry-id="${p.id}" data-source="log" title="Delete Entry"><i class="fas fa-trash"></i></button>`;
                break;
            case 'treatment':
                sourceText = '<span class="badge bg-secondary">From Treatment Log</span>';
                actions = isProfile ? '' : `<button class="btn btn-sm btn-outline-danger js-delete-weight" data-record-id="${recordId}" data-entry-id="${p.id}" data-source="treatment" title="This is legacy data. Deleting it will remove the weight from the associated treatment log."><i class="fas fa-trash"></i></button>`;
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

    let adg = 0;
    if (timeDiffDays > 0) {
        adg = (weightGain / timeDiffDays) * 1000; // in grams
    }

    container.innerHTML = `
        <h5 class="card-title mb-3">Weight Statistics</h5>
        <div class="mb-3">
            <p class="mb-0 text-muted">Average Daily Gain (ADG)</p>
            <h3 class="text-success">${adg.toFixed(0)} g/day</h3>
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
        return (weightGain / timeDiffDays) * 1000; // in grams
    }
    return null;
}

function updateGrowthAnalytics() {
    const fastestList = document.getElementById('fastestGrowersList');
    const slowestList = document.getElementById('slowestGrowersList');
    fastestList.innerHTML = '<li class="list-group-item text-muted">Calculating...</li>';
    slowestList.innerHTML = '<li class="list-group-item text-muted">Calculating...</li>';

    const sheepWithAdg = allRecords
        .map(record => ({ sheepId: record.sheepId, adg: calculateADG(record) }))
        .filter(item => item.adg !== null && !isNaN(item.adg));

    if (sheepWithAdg.length === 0) {
        const noDataHtml = '<li class="list-group-item text-muted">Not enough data for ADG calculation.</li>';
        fastestList.innerHTML = noDataHtml;
        slowestList.innerHTML = noDataHtml;
        return;
    }

    const sortedFastest = [...sheepWithAdg].sort((a, b) => b.adg - a.adg);
    fastestList.innerHTML = sortedFastest.slice(0, 5).map(s => `<li class="list-group-item d-flex justify-content-between align-items-center">${s.sheepId} <span class="badge bg-success rounded-pill">${s.adg.toFixed(0)} g/day</span></li>`).join('') || '<li class="list-group-item text-muted">No sheep with calculated growth.</li>';

    const sortedSlowest = [...sheepWithAdg].sort((a, b) => a.adg - a.adg);
    slowestList.innerHTML = sortedSlowest.map(s => {
        const badgeClass = s.adg < 0 ? 'bg-danger' : 'bg-warning text-dark';
        return `<li class="list-group-item d-flex justify-content-between align-items-center">${s.sheepId} <span class="badge ${badgeClass} rounded-pill">${s.adg.toFixed(0)} g/day</span></li>`;
    }).join('') || '<li class="list-group-item text-muted">No sheep with calculated growth.</li>';
}

// --- FORM & MODAL HANDLERS ---

function handleAddRecord(e) {
    e.preventDefault();
    const newRecord = {
        sheepId: document.getElementById('sheepId').value.trim(),
        healthStatus: document.getElementById('healthStatus').value,
        dateRecorded: document.getElementById('dateRecorded').value,
        notes: document.getElementById('notes').value.trim(),
        weight: document.getElementById('weight').value || null,
        temperature: document.getElementById('temperature').value || null,
    };
    if (!newRecord.sheepId || !newRecord.dateRecorded) return alert("Sheep ID and Date are required.");
    const isDuplicate = allRecords.some(record => record.sheepId.toLowerCase() === newRecord.sheepId.toLowerCase());
    if (isDuplicate) {
        alert(`Error: A sheep with ID "${newRecord.sheepId}" already exists in the active records. Please use a unique ID.`);
        return;
    }
    push(ref(db, 'sheepHealthRecords'), newRecord).then(() => {
        e.target.reset();
        document.getElementById('dateRecorded').valueAsDate = new Date();
    });
}

function openEditModal(recordId) {
    const record = allRecords.find(r => r.id === recordId);
    if (!record) return;
    document.getElementById('editRecordId').value = recordId;
    document.getElementById('editSheepId').value = record.sheepId;
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

    const tbody = document.getElementById('treatmentLogTbody');
    const treatmentsRef = ref(db, `sheepHealthRecords/${recordId}/treatments`);
    onValue(treatmentsRef, snapshot => {
        tbody.innerHTML = '';
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const entry = { id: child.key, ...child.val() };
                tbody.innerHTML += `<tr>
                    <td>${formatDate(entry.treatmentDate)}</td>
                    <td>${entry.symptoms || ''}</td>
                    <td>${entry.medication || ''}</td>
                    <td>${entry.dosage || ''}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary js-edit-treatment" data-record-id="${recordId}" data-entry-id="${entry.id}"><i class="fas fa-pencil-alt"></i></button>
                        <button class="btn btn-sm btn-outline-danger js-delete-treatment" data-record-id="${recordId}" data-entry-id="${entry.id}"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No treatment entries yet.</td></tr>';
        }
    }, { onlyOnce: false }); // Ensure this listener stays active while modal is open
    treatmentLogModal.show();
}

function handleSaveTreatment(e) {
    e.preventDefault();
    const recordId = document.getElementById('currentSheepRecordId').value;
    const entryId = document.getElementById('treatmentEntryId').value;
    const treatmentType = document.getElementById('treatmentType').value;
    const treatmentDate = document.getElementById('treatmentDate').value;
    const treatmentWeight = parseFloat(document.getElementById('treatmentWeight').value);

    const entryData = {
        treatmentDate: treatmentDate,
        treatmentType: treatmentType,
        symptoms: document.getElementById('symptoms').value,
        medication: document.getElementById('medication').value,
        dosage: document.getElementById('dosage').value,
        followUpDate: document.getElementById('followUpDate').value,
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
    });
}

function editTreatmentEntry(recordId, entryId) {
    const entryRef = ref(db, `sheepHealthRecords/${recordId}/treatments/${entryId}`);
    onValue(entryRef, snapshot => {
        const entry = snapshot.val();
        document.getElementById('treatmentEntryId').value = entryId;
        document.getElementById('treatmentType').value = entry.treatmentType || 'General';
        document.getElementById('treatmentDate').value = entry.treatmentDate;
        document.getElementById('symptoms').value = entry.symptoms || '';
        document.getElementById('medication').value = entry.medication || '';
        document.getElementById('dosage').value = entry.dosage || '';
        document.getElementById('followUpDate').value = entry.followUpDate || '';
        document.getElementById('treatmentWeight').value = '';
        document.getElementById('treatmentNotes').value = entry.treatmentNotes || '';
    }, { onlyOnce: true });
}

function deleteTreatmentEntry(recordId, entryId) {
    if (confirm('Delete this treatment entry?')) {
        remove(ref(db, `sheepHealthRecords/${recordId}/treatments/${entryId}`));
    }
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

    document.getElementById('profileSheepId').textContent = record.sheepId;
    document.getElementById('profileHealthStatus').innerHTML = `<span class="${getStatusClass(record.healthStatus)}">${record.healthStatus}</span>`;
    document.getElementById('profileDateRecorded').textContent = formatDate(record.dateRecorded);
    document.getElementById('profileInitialNotes').textContent = record.notes || 'N/A';

    const saleInfoCard = document.getElementById('profileSaleInfoCard');
    if (record.saleDate) {
        saleInfoCard.style.display = 'block';
        document.getElementById('profileSaleDate').textContent = formatDate(record.saleDate);
        document.getElementById('profileSalePrice').textContent = record.salePrice ? `$${record.salePrice}` : 'N/A';
        document.getElementById('profileSaleBuyer').textContent = record.saleBuyer || 'N/A';
        document.getElementById('profileSaleNotes').textContent = record.saleNotes || 'N/A';
    } else {
        saleInfoCard.style.display = 'none';
    }

    const dewormingStatus = getScheduleStatus(record.lastDewormingDate, 30, null);
    const vaccinationStatus = getScheduleStatus(record.lastVaccinationDate, 365, record.manualVaccinationDueDate);
    document.getElementById('profileDewormingStatus').innerHTML = renderScheduleStatusBadge(dewormingStatus, record.lastDewormingDate);
    document.getElementById('profileDewormingNotes').textContent = record.lastDewormingNotes || 'N/A';
    document.getElementById('profileVaccinationStatus').innerHTML = renderScheduleStatusBadge(vaccinationStatus, record.lastVaccinationDate);
    document.getElementById('profileVaccinationNotes').textContent = record.lastVaccinationNotes || 'N/A';

    renderWeightProfile(record);
    renderTreatmentProfile(record);
    updateProfileNavButtons();
}

function renderWeightProfile(record) {
    const displayArea = document.getElementById('profileWeightDisplayArea');
    const startDate = new Date(record.dateRecorded + 'T00:00:00');
    if (isNaN(startDate.getTime())) {
        displayArea.innerHTML = '<div class="alert alert-warning">Cannot display weight chart due to invalid start date.</div>';
        return;
    }

    const allWeightPoints = gatherAllWeightData(record);
    renderWeightDataTable(allWeightPoints, record.id, 'profileWeightTableContainer');
    calculateAndDisplayWeightStats(allWeightPoints, 'profileWeightStatsBody');

    const chartPoints = allWeightPoints.map(dp => ({ x: (dp.date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 7), y: dp.weight }));

    if (chartPoints.length < 1) {
        document.getElementById('profileWeightChartContainer').innerHTML = '<div class="alert alert-info text-center h-100 d-flex align-items-center justify-content-center">No weight data to display.</div>';
        if (profileWeightChart) { profileWeightChart.destroy(); profileWeightChart = null; }
        return;
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
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Weeks Since Record Start Date' } },
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
            <td>${entry.symptoms || ''}</td>
            <td>${entry.medication || ''}</td>
            <td>${entry.dosage || ''}</td>
            <td>${entry.treatmentNotes || ''}</td>
        </tr>`).join('');
    } else {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No treatment history recorded.</td></tr>';
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
        const record = allRecords.find(r => r.id === recordId);
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

    let promise;
    if (source === 'initial') {
        promise = update(ref(db, `sheepHealthRecords/${recordId}`), { weight: weight, dateRecorded: date });
    } else {
        const data = { date, weight };
        const path = ref(db, `sheepHealthRecords/${recordId}/weights`);
        promise = entryId ? update(child(path, entryId), data) : push(path, data);
    }

    promise.then(() => {
        weightEntryModal.hide();
    }).catch(err => alert('Error saving weight: ' + err.message));
}

function deleteWeightEntry(recordId, entryId, source) {
    if (!confirm('Are you sure you want to delete this weight entry?')) return;

    let promise;
    if (source === 'initial') {
        promise = remove(ref(db, `sheepHealthRecords/${recordId}/weight`));
    } else if (source === 'log') {
        promise = remove(ref(db, `sheepHealthRecords/${recordId}/weights/${entryId}`));
    } else if (source === 'treatment') {
        promise = remove(ref(db, `sheepHealthRecords/${recordId}/treatments/${entryId}/weight`));
    }

    if (promise) {
        promise.catch(err => alert('Error deleting entry: ' + err.message));
    }
}

// --- ANALYTICS SECTION ---

function updateAnalytics() {
    const total = allRecords.length;
    const healthy = allRecords.filter(r => r.healthStatus === 'Healthy' || r.healthStatus === 'Recovering').length;
    const corentin = allRecords.filter(r => r.healthStatus === 'Corentin').length;
    const treatment = allRecords.filter(r => r.healthStatus === 'Under Treatment').length;

    document.getElementById('totalCount').textContent = total;
    document.getElementById('healthyCount').textContent = healthy;
    document.getElementById('sickCount').textContent = corentin;
    document.getElementById('treatmentCount').textContent = treatment;

    renderAnalyticsChart(healthy, corentin, treatment);
}

function renderAnalyticsChart(healthy, corentin, treatment) {
    const ctx = document.getElementById('healthStatusChart').getContext('2d');

    if (healthStatusChart) {
        healthStatusChart.destroy();
    }

    healthStatusChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Healthy/Recovering', 'Corentin', 'Under Treatment'],
            datasets: [{
                label: 'Sheep Status',
                data: [healthy, corentin, treatment],
                backgroundColor: [
                    'rgba(40, 167, 69, 0.8)',
                    'rgba(220, 53, 69, 0.8)',
                    'rgba(255, 193, 7, 0.8)'
                ],
                borderColor: ['#fff'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'top' }
            }
        }
    });
}

// --- UTILITY FUNCTIONS ---

function getStatusClass(status) {
    if (status === 'Healthy' || status === 'Recovering') return 'status-healthy';
    if (status === 'Corentin' || status === 'Deceased') return 'status-corentin';
    if (status === 'Under Treatment') return 'status-treatment';
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

function exportSoldData() {
    if (soldRecords.length === 0) {
        alert('No sold records to export.');
        return;
    }
    const csv = convertSoldToCSV(soldRecords);
    downloadCSV(csv, 'sold_sheep_records.csv');
}

function convertSoldToCSV(data) {
    const headers = ['Sheep ID', 'Health Status', 'Date Sold', 'Price', 'Buyer', 'Notes'];
    const rows = data.map(record => [`"${record.sheepId || ''}"`, `"${record.healthStatus || ''}"`, `"${record.saleDate || ''}"`, `"${record.salePrice || ''}"`, `"${record.saleBuyer || ''}"`, `"${(record.saleNotes || '').replace(/"/g, '""')}"`].join(','));
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
    const headers = ['Sheep ID', 'Health Status', 'Date Recorded', 'Weight (kg)', 'Temperature (°C)', 'Notes'];
    const rows = data.map(record =>
        [
            `"${record.sheepId || ''}"`,
            `"${record.healthStatus || ''}"`,
            `"${record.dateRecorded || ''}"`,
            `"${record.weight || ''}"`,
            `"${record.temperature || ''}"`,
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
    // Initialize Bootstrap Modals
    editSheepModal = new bootstrap.Modal(document.getElementById('editSheepModal'));
    saleSheepModal = new bootstrap.Modal(document.getElementById('saleSheepModal'));
    treatmentLogModal = new bootstrap.Modal(document.getElementById('treatmentLogModal'));
    weightEntryModal = new bootstrap.Modal(document.getElementById('weightEntryModal'));
    batchTreatmentModal = new bootstrap.Modal(document.getElementById('batchTreatmentModal'));

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
        else if (target.closest('.js-delete-sold-record')) deleteSoldRecord(recordId, sheepId);
        else if (target.closest('.js-delete-archived-record')) deleteArchivedRecord(recordId, sheepId);
        else if (target.closest('.js-edit-treatment')) editTreatmentEntry(recordId, recordBtn.dataset.entryId);
        else if (target.closest('.js-delete-treatment')) deleteTreatmentEntry(recordId, recordBtn.dataset.entryId);
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
        else if (target.closest('.js-export-sold')) exportSoldData();
        else if (target.closest('.notification-item')) {
            e.preventDefault();
            viewRecordFromNotification(target.closest('.notification-item').dataset.recordId);
        }
    });

    // --- Navigation ---
    document.querySelector('.dashboard-sidebar .nav').addEventListener('click', e => {
        const link = e.target.closest('a.nav-link[data-section]');
        if (link) {
            e.preventDefault();
            showSection(link.dataset.section);
        }
    });

    // --- Form Submissions ---
    document.getElementById('sheepHealthForm').addEventListener('submit', handleAddRecord);
    document.getElementById('editSheepForm').addEventListener('submit', handleUpdateRecord);
    document.getElementById('saleSheepForm').addEventListener('submit', handleSaleSubmit);
    document.getElementById('addTreatmentForm').addEventListener('submit', handleSaveTreatment);
    document.getElementById('batchTreatmentForm').addEventListener('submit', handleBatchSaveTreatment);
    document.getElementById('weightEntryForm').addEventListener('submit', handleSaveWeight);

    // --- Filters & Search ---
    document.getElementById('scheduleFilterButtons').addEventListener('click', e => {
        if (e.target.matches('button')) updateScheduleView(e.target.dataset.filter);
    });
    document.getElementById('weeklyFilterButtons').addEventListener('click', e => {
        if (e.target.matches('button')) updateWeeklyTrackingView(e.target.dataset.filter);
    });
    mainApp.addEventListener('keyup', e => {
        if (e.target.matches('input[data-table-body-id]')) {
            filterTableBySheepId(e.target, e.target.dataset.tableBodyId);
        } else if (e.target.matches('#profileSearchInput')) {
            filterProfileSelector();
        }
    });

    // --- Dynamic UI Listeners ---
    document.getElementById('scheduleTableBody').addEventListener('change', e => {
        if (e.target.matches('.sheep-select-checkbox')) updateBatchLogUI();
    });
    document.getElementById('selectAllSchedule').addEventListener('change', e => {
        document.querySelectorAll('#scheduleTableBody .sheep-select-checkbox').forEach(cb => cb.checked = e.target.checked);
        updateBatchLogUI();
    });
    document.getElementById('profileSheepSelector').addEventListener('change', e => {
        if (e.target.value) renderProfileForSheep(e.target.value);
    });
    document.getElementById('weightSheepSelector').addEventListener('change', e => {
        if (e.target.value) renderWeightChartForSheep(e.target.value);
    });
    document.getElementById('addWeightBtn').addEventListener('click', () => {
        const recordId = document.getElementById('weightSheepSelector').value;
        if (recordId) openWeightModal(recordId);
    });
}