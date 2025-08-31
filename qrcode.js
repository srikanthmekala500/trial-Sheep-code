document.addEventListener('DOMContentLoaded', () => {
    // --- Elements for QR Code SCANNING ---
    const scanQrBtn = document.getElementById('scanQrBtn');
    const qrScannerModalElement = document.getElementById('qrScannerModal');
    const profileSheepSelector = document.getElementById('profileSheepSelector');
    const mainNav = document.getElementById('mainNav');
    const qrReaderResults = document.getElementById('qr-reader-results');
    
    // --- Elements for QR Code GENERATION ---
    const showQrCodeBtn = document.getElementById('showQrCodeBtn');
    const qrDisplayModalElement = document.getElementById('qrDisplayModal');
    const qrDisplayTitle = document.getElementById('qrDisplayTitle');
    const qrDisplaySheepId = document.getElementById('qrDisplaySheepId');
    const qrDisplayStatus = document.getElementById('qrDisplayStatus');
    const qrCanvas = document.getElementById('qrCanvas');
    const printQrBtn = document.getElementById('printQrBtn');
    const profileSheepIdElement = document.getElementById('profileSheepId');
    const profileHealthStatusElement = document.getElementById('profileHealthStatus');
 
    // --- Elements for BULK QR Code Generation ---
    const bulkGenerateQrBtn = document.getElementById('bulkGenerateQrBtn');
    const bulkQrModalElement = document.getElementById('bulkQrModal');
    const bulkQrContainer = document.getElementById('bulkQrContainer');
    const printBulkQrBtn = document.getElementById('printBulkQrBtn');
    
    // Gracefully exit if essential elements aren't on the page
    if (!scanQrBtn || !qrScannerModalElement || !profileSheepSelector || !mainNav || !showQrCodeBtn || !profileHealthStatusElement) {
        console.warn('One or more QR module UI elements not found. Functionality may be limited.');
        return;
    }
    
    // =================================================================
    // QR Code SCANNING Logic
    // =================================================================
    
    const qrScannerModal = new bootstrap.Modal(qrScannerModalElement);
    let html5QrCode;
    
    /**
     * Handles the successful scan of a QR code.
     * @param {string} decodedText - The text decoded from the QR code.
     * @param {object} decodedResult - The full result object from the scanner.
     */
    const onScanSuccess = (decodedText, decodedResult) => {
        // Pause the scanner to prevent multiple rapid scans while we process.
        html5QrCode.pause();

        console.log(`QR Code detected: ${decodedText}`);

        // Find the option in the dropdown that matches the scanned ID (user-facing ID)
        const matchingOption = [...profileSheepSelector.options].find(option => option.textContent === decodedText);

        if (matchingOption) {
            // --- SUCCESS PATH ---
            qrReaderResults.innerHTML = `<div class="alert alert-success">Found: <strong>${decodedText}</strong>. Loading profile...</div>`;

            // Stop scanning permanently to release the camera
            html5QrCode.stop().then(() => {
                // Hide the modal after a short delay to show the success message
                setTimeout(() => {
                    qrScannerModal.hide();
                }, 500);

                // Find the navigation link for the 'profile' section
                const profileLink = mainNav.querySelector('a[data-section="profile"]');
                
                // Switch to the profile tab if not already active.
                // This simulates a user click, which the main app.js should handle.
                if (profileLink && !profileLink.classList.contains('active')) {
                    profileLink.click();
                }
                
                // Set the dropdown value to the Firebase ID from the matching option
                profileSheepSelector.value = matchingOption.value;
                
                // Dispatch a 'change' event to trigger the profile load logic in app.js
                profileSheepSelector.dispatchEvent(new Event('change', { bubbles: true }));

                console.log(`Successfully triggered profile view for ${decodedText}.`);

            }).catch(err => {
                console.error('Failed to stop QR scanner after success.', err);
                qrScannerModal.hide(); // Still try to hide the modal
            });
        } else {
            // --- NOT FOUND PATH ---
            // The ID is not in the active list. Stop the scanner and offer to search other sections.
            html5QrCode.stop().catch(err => console.warn("Scanner stopped to show search options.", err));

            qrReaderResults.innerHTML = `
                <div class="alert alert-warning" role="alert">
                    <h5 class="alert-heading">ID Not Found in Active Flock</h5>
                    <p>The scanned ID <strong>"${decodedText}"</strong> is not active. It may have been sold or marked as deceased.</p>
                    <hr>
                    <p class="mb-0">Where would you like to search?</p>
                </div>
                <div class="d-grid gap-2 mt-2">
                    <button class="btn btn-outline-success" id="searchSoldBtn">
                        <i class="fas fa-dollar-sign me-2"></i>Search in Sold Records
                    </button>
                    <button class="btn btn-outline-secondary" id="searchArchivedBtn">
                        <i class="fas fa-archive me-2"></i>Search in Deceased Records
                    </button>
                </div>
            `;

            // Helper function to navigate to a section and pre-fill the search bar
            const navigateToSection = (sectionId) => {
                qrScannerModal.hide();
                const link = mainNav.querySelector(`a[data-section="${sectionId}"]`);
                if (link) {
                    link.click();
                    // Auto-fill the search bar on the target page for a seamless experience
                    setTimeout(() => {
                        // Find the search input within the newly visible section
                        const searchInput = document.querySelector(`#${sectionId}Section input[data-table-body-id]`);
                        if (searchInput) {
                            searchInput.value = decodedText;
                            // Dispatch an 'input' event to trigger the filtering logic in app.js
                            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    }, 250); // Delay to allow the section to become visible
                }
            };

            // Add event listeners to the new buttons
            document.getElementById('searchSoldBtn').addEventListener('click', () => navigateToSection('saled'));
            document.getElementById('searchArchivedBtn').addEventListener('click', () => navigateToSection('archived'));
        }
    };
    
    /**
     * Handles scan failures. This is called frequently, so keep it lightweight.
     * @param {string} error - The error message.
     */
    const onScanFailure = (error) => {
         // We can ignore most errors as the scanner will keep trying.
        // console.warn(`QR error = ${error}`);
    };
    
    // Add click listener to the main "Scan QR" button
    scanQrBtn.addEventListener('click', () => {
        qrScannerModal.show();
    });
    
    // When the scanner modal is shown, initialize and start the camera
    qrScannerModalElement.addEventListener('shown.bs.modal', () => {
        qrReaderResults.innerHTML = ''; // Clear previous results
        html5QrCode = new Html5Qrcode("qr-reader");
        const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
        
        // Start scanning using the back camera
        html5QrCode.start(
            { facingMode: "environment" },
            config,
            onScanSuccess,
            onScanFailure
        ).catch(err => {
            console.error('Unable to start QR code scanner.', err);
            document.getElementById('qr-reader').innerHTML = `<div class="alert alert-danger"><strong>Error:</strong> Could not start QR scanner. Please ensure your browser has camera permissions.</div>`;
        });
    });
    
    // When the scanner modal is hidden, ensure the camera is released
    qrScannerModalElement.addEventListener('hidden.bs.modal', () => {
        if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().catch(err => {
                 // This can sometimes throw an error if already stopped, which is fine.
                console.warn('Error stopping the scanner on modal close, it might have already been stopped.', err);
            });
        }
    });
    
    // =================================================================
    // QR Code GENERATION Logic
    // =================================================================
    
    const qrDisplayModal = new bootstrap.Modal(qrDisplayModalElement);
    
    // Add event listener for the "Generate QR" button on the profile page
    showQrCodeBtn.addEventListener('click', () => {
        const sheepId = profileSheepIdElement.textContent;
        const healthStatusText = profileHealthStatusElement.textContent.trim();
 
        if (sheepId && typeof QRCode !== 'undefined') {
            // Set the Sheep ID in its span
            qrDisplaySheepId.textContent = sheepId;
            
            // Set the health status badge
            if (healthStatusText) {
                // Display status as plain text next to the ID
                qrDisplayStatus.textContent = `- ${healthStatusText}`;
            } else {
                qrDisplayStatus.textContent = '';
            }
 
            // Use the QRCode.js library to generate the code
            QRCode.toCanvas(qrCanvas, sheepId, { width: 256, errorCorrectionLevel: 'H' }, function (error) {
                if (error) {
                    console.error(error);
                    // Clear canvas on error
                    qrCanvas.getContext('2d').clearRect(0, 0, qrCanvas.width, qrCanvas.height);
                    alert('Could not generate QR code.');
                } else {
                    console.log(`QR code for ${sheepId} generated successfully.`);
                    qrDisplayModal.show();
                }
            });
        } else if (!sheepId) {
            alert('No sheep profile is currently selected.');
        } else {
            alert('QR Code generation library is not loaded.');
        }
    });
    
    // Add a helper to print the generated QR code
    printQrBtn.addEventListener('click', () => {
        const sheepId = qrDisplaySheepId.textContent;
        const statusText = profileHealthStatusElement.textContent.trim(); // Get current status
        const canvasImage = qrCanvas.toDataURL('image/png');
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Print QR Code - ${sheepId}</title>
                    <style>
                        @media print { body { -webkit-print-color-adjust: exact; } }
                        body { font-family: sans-serif; text-align: center; margin-top: 50px; }
                        img { max-width: 80%; border: 1px solid #ccc; }
                        h1 { font-size: 24px; margin-bottom: 5px; }
                        p { font-size: 18px; margin-top: 0; color: #333; }
                    </style>
                </head>
                <body>
                    <h1>Sheep ID: ${sheepId}</h1>
                    ${statusText ? `<p>Status: ${statusText}</p>` : ''}
                    <img src="${canvasImage}" alt="QR Code for ${sheepId}">
                    <script>window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; }<\/script>
                </body>
            </html>
        `);
        printWindow.document.close();
    });

    // =================================================================
    // BULK QR Code GENERATION Logic
    // =================================================================
    if (bulkGenerateQrBtn && bulkQrModalElement && bulkQrContainer && printBulkQrBtn) {
        const bulkQrModal = new bootstrap.Modal(bulkQrModalElement);

        bulkGenerateQrBtn.addEventListener('click', () => {
            // Clear previous content and show a loading message
            bulkQrContainer.innerHTML = '<div class="col-12 text-center d-print-none"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><p class="mt-2">Generating codes...</p></div>';
            bulkQrModal.show();

            // Use a short timeout to allow the modal to render before the heavy lifting starts
            setTimeout(async () => {
                bulkQrContainer.innerHTML = ''; // Clear loading message
                
                // Get all sheep IDs from the main profile selector, which is the source of truth for active sheep
                const sheepOptions = profileSheepSelector.querySelectorAll('option');
                if (sheepOptions.length === 0 || (sheepOptions.length === 1 && sheepOptions[0].disabled)) {
                    bulkQrContainer.innerHTML = '<div class="col-12 alert alert-warning">No active sheep found to generate QR codes for.</div>';
                    return;
                }

                const generationPromises = [];

                for (const option of sheepOptions) {
                    if (option.value && !option.disabled) {
                        // Use option.textContent for the user-facing ID, not option.value (which is the Firebase ID)
                        const sheepId = option.textContent;
                        
                        // Create a container for each QR code
                        const qrItem = document.createElement('div');
                        qrItem.className = 'col qr-item text-center';
                        
                        const canvas = document.createElement('canvas');
                        
                        const title = document.createElement('h6');
                        title.className = 'mt-1 small';
                        title.textContent = sheepId;
                        
                        qrItem.appendChild(canvas);
                        qrItem.appendChild(title);
                        bulkQrContainer.appendChild(qrItem);
                        
                        // Generate QR code onto the new canvas. We push the promise to an array.
                        const promise = QRCode.toCanvas(canvas, sheepId, { width: 150, margin: 2, errorCorrectionLevel: 'H' })
                            .catch(err => {
                                console.error(`Failed to generate QR for ${sheepId}`, err);
                                title.textContent = `${sheepId} (Error)`;
                                title.classList.add('text-danger');
                            });
                        generationPromises.push(promise);
                    }
                }
                await Promise.all(generationPromises);
                console.log('All bulk QR codes generated.');
            }, 200); // 200ms delay
        });

        printBulkQrBtn.addEventListener('click', () => {
            window.print();
        });
    }
});
