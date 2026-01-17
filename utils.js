/**
 * Formats a date string (YYYY-MM-DD) into DD/MM/YY.
 * @param {string} dateString - The date string to format.
 * @returns {string} The formatted date or the original string if invalid.
 */
export function formatDate(dateString) {
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
 * Escapes HTML special characters in a string to prevent XSS.
 * @param {string} str - The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const p = document.createElement("p");
    p.textContent = str;
    return p.innerHTML;
}

/**
 * Shows a toast notification. Creates the container if it doesn't exist.
 * @param {string} title - The title of the toast.
 * @param {string} message - The body message of the toast.
 * @param {string} [type='success'] - The type of toast ('success', 'danger', 'info', 'warning').
 */
export function showToast(title, message, type = 'success') {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
        toastContainer.style.zIndex = '1100';
        document.body.appendChild(toastContainer);
    }

    const toastId = 'toast-' + Date.now();
    let iconClass = 'fa-info-circle text-info';
    switch (type) {
        case 'success': iconClass = 'fa-check-circle text-success'; break;
        case 'danger': iconClass = 'fa-exclamation-triangle text-danger'; break;
        case 'warning': iconClass = 'fa-exclamation-circle text-warning'; break;
    }

    const toastHtml = `
        <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true" style="min-width: 500px;">
            <div class="toast-header">
                <i class="fas ${iconClass} fa-lg me-2"></i>
                <strong class="me-auto">${title}</strong>
                <small>Just now</small>
                <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body" style="font-size: 1.05rem;">${message}</div>
        </div>
    `;
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 5000 });
    toast.show();
    toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
}