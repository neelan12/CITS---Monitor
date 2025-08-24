// app.js - Main Application Logic

// App State
let appState = {
    selectedJunction: null,
    junctionData: {}, // Store all junction-specific data
    currentLocation: null,
    map: null,
    markers: {
        junction: null,
        current: null
    }
};

// Initialize Local Storage
const STORAGE_KEY = 'cits_inspection_data';

function loadFromStorage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            appState = { ...appState, ...data };
        } catch (e) {
            console.error('Error loading saved data:', e);
        }
    }
}

function saveToStorage() {
    try {
        const dataToSave = {
            selectedJunction: appState.selectedJunction,
            junctionData: appState.junctionData
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
        console.error('Error saving data:', e);
    }
}

// Initialize App
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing app...');
    loadFromStorage();
    initializeJunctionList();
    initializeEventListeners();
    initializeMap();
    checkOnlineStatus();
    initializePWA();
    updateSummaryTab();
    setToday(); // Set today's date as default
    
    if (appState.selectedJunction) {
        selectJunction(appState.selectedJunction);
    }
});

// Junction List Initialization
function initializeJunctionList() {
    console.log('Initializing junction list with', junctionData.length, 'junctions');
    renderJunctionList(junctionData);
}

function renderJunctionList(junctions) {
    const listContainer = document.getElementById('junctionList');
    if (!listContainer) {
        console.error('Junction list container not found');
        return;
    }
    
    listContainer.innerHTML = junctions.map(junction => {
        const junctionStatus = getJunctionStatus(junction.Location_Id);
        const statusClass = junctionStatus === 'complete' ? 'completed' : '';
        const badgeHtml = junctionStatus === 'complete' ? 
            '<span class="junction-status-badge complete">✔</span>' :
            junctionStatus === 'partial' ? 
            '<span class="junction-status-badge partial">◐</span>' : '';
        
        // Properly escape the junction data for onclick
        const junctionDataStr = JSON.stringify(junction).replace(/"/g, '&quot;');
        
        return `
            <div class="junction-item ${appState.selectedJunction?.Location_Id === junction.Location_Id ? 'selected' : ''} ${statusClass}" 
                 onclick='selectJunction(${junctionDataStr})'>
                <div class="junction-id ${statusClass}">${junction.Location_Id}</div>
                <div class="junction-details">
                    <div class="junction-name">${junction.Name}</div>
                    <div class="junction-corridor">📍 ${junction.Corridors_Name}</div>
                </div>
                ${badgeHtml}
            </div>
        `;
    }).join('');
}

// Get Junction Status
function getJunctionStatus(junctionId) {
    const data = appState.junctionData[junctionId];
    if (!data || !data.activities) return 'pending';
    
    const completedCount = Object.values(data.activities).filter(a => a.status === 'completed').length;
    
    if (completedCount === activities.length) return 'complete';
    if (completedCount > 0) return 'partial';
    return 'pending';
}

// Select Junction
window.selectJunction = function(junction) {
    console.log('Selecting junction:', junction.Name);
    appState.selectedJunction = junction;
    
    // Initialize junction data if not exists
    if (!appState.junctionData[junction.Location_Id]) {
        appState.junctionData[junction.Location_Id] = {
            activities: {},
            lastUpdated: null,
            submittedAt: null
        };
    }
    
    // Update UI
    document.querySelectorAll('.junction-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Find and highlight selected junction
    const junctions = document.querySelectorAll('.junction-item');
    junctions.forEach(item => {
        if (item.querySelector('.junction-id').textContent == junction.Location_Id) {
            item.classList.add('selected');
        }
    });
    
    // Update Selected Junction Info
    const infoDiv = document.getElementById('selectedJunctionInfo');
    const nameEl = document.getElementById('selectedJunctionName');
    const detailsEl = document.getElementById('selectedJunctionDetails');
    
    if (junction && nameEl && detailsEl) {
        nameEl.textContent = junction.Name;
        detailsEl.innerHTML = `
            <strong>Junction ID:</strong> ${junction.Location_Id} | 
            <strong>Corridor:</strong> ${junction.Corridors_Name} | 
            <strong>Coordinates:</strong> ${junction.Latitude.toFixed(6)}, ${junction.Longitude.toFixed(6)}
        `;
        if (infoDiv) infoDiv.classList.add('show');
        
        // Update Map
        updateMap(junction);
        
        // Show Map
        const mapEl = document.getElementById('map');
        if (mapEl) mapEl.classList.add('show');
        
        // Update Activities Tab
        initializeActivities();
        updateCurrentJunctionBanner();
    }
    
    saveToStorage();
    showToast('Junction selected: ' + junction.Name, 'success');
}

// Update Current Junction Banner
function updateCurrentJunctionBanner() {
    const banner = document.getElementById('currentJunctionBanner');
    const nameEl = document.getElementById('currentJunctionName');
    const detailsEl = document.getElementById('currentJunctionDetails');
    
    if (appState.selectedJunction && banner && nameEl && detailsEl) {
        nameEl.textContent = appState.selectedJunction.Name;
        detailsEl.textContent = `Junction ID: ${appState.selectedJunction.Location_Id} | Corridor: ${appState.selectedJunction.Corridors_Name}`;
        banner.style.display = 'block';
    } else if (banner) {
        banner.style.display = 'none';
    }
}

// Initialize Map
function initializeMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer || typeof L === 'undefined') {
        console.log('Map container not found or Leaflet not loaded');
        return;
    }
    
    try {
        appState.map = L.map('map').setView([13.0827, 80.2707], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(appState.map);
        
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                position => {
                    appState.currentLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    
                    if (appState.markers.current) {
                        appState.markers.current.remove();
                    }
                    
                    appState.markers.current = L.marker([appState.currentLocation.lat, appState.currentLocation.lng], {
                        icon: L.divIcon({
                            className: 'current-location-marker',
                            html: '<div style="background: #4285f4; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
                            iconSize: [16, 16]
                        })
                    }).addTo(appState.map);
                    
                    appState.markers.current.bindPopup('📍 Your Current Location').openPopup();
                },
                error => {
                    console.log('Location access denied');
                }
            );
        }
    } catch (e) {
        console.error('Error initializing map:', e);
    }
}

// Update Map with Junction
function updateMap(junction) {
    if (!appState.map || typeof L === 'undefined') return;
    
    try {
        if (appState.markers.junction) {
            appState.markers.junction.remove();
        }
        
        appState.markers.junction = L.marker([junction.Latitude, junction.Longitude], {
            icon: L.divIcon({
                className: 'junction-marker',
                html: '<div style="background: #dc2626; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
                iconSize: [26, 26]
            })
        }).addTo(appState.map);
        
        appState.markers.junction.bindPopup(`
            <strong>${junction.Name}</strong><br>
            Junction ID: ${junction.Location_Id}<br>
            Corridor: ${junction.Corridors_Name}
        `).openPopup();
        
        appState.map.setView([junction.Latitude, junction.Longitude], 16);
    } catch (e) {
        console.error('Error updating map:', e);
    }
}

// Initialize Activities
function initializeActivities() {
    const activitySection = document.getElementById('activitySection');
    if (!activitySection || !appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    const junctionActivities = appState.junctionData[junctionId]?.activities || {};
    
    activitySection.innerHTML = activities.map((activity, index) => {
        const activityData = junctionActivities[activity] || { status: 'pending', observation: '', photos: [], dates: {} };
        
        // Create date stamps HTML
        let dateStampsHTML = '';
        if (activityData.dates) {
            if (activityData.dates.progressDate) {
                dateStampsHTML += `<span class="date-stamp progress"><span class="date-stamp-label">Started:</span> ${formatDate(activityData.dates.progressDate)}</span>`;
            }
            if (activityData.dates.completedDate) {
                dateStampsHTML += `<span class="date-stamp completed"><span class="date-stamp-label">Completed:</span> ${formatDate(activityData.dates.completedDate)}</span>`;
            }
        }
        
        const activityEscaped = activity.replace(/'/g, "\\'");
        
        return `
            <div class="activity-card">
                <div class="activity-header">
                    <span class="activity-name">${activity}</span>
                    <span class="activity-number">${index + 1}/${activities.length}</span>
                </div>
                <div class="status-selector">
                    <button class="status-btn completed ${activityData.status === 'completed' ? 'selected' : ''}" 
                            onclick="updateActivityStatus('${activityEscaped}', 'completed')">
                        ✅ Completed
                    </button>
                    <button class="status-btn progress ${activityData.status === 'progress' ? 'selected' : ''}" 
                            onclick="updateActivityStatus('${activityEscaped}', 'progress')">
                        🔄 In Progress
                    </button>
                    <button class="status-btn pending ${activityData.status === 'pending' ? 'selected' : ''}" 
                            onclick="updateActivityStatus('${activityEscaped}', 'pending')">
                        ⏳ Yet to Start
                    </button>
                </div>
                ${dateStampsHTML ? `<div class="activity-dates">${dateStampsHTML}</div>` : ''}
                <div class="activity-extras">
                    <div class="activity-observation">
                        <label>📝 Observation/Notes:</label>
                        <textarea 
                            placeholder="Add observations for ${activity}..." 
                            onchange="updateActivityObservation('${activityEscaped}', this.value)"
                            >${activityData.observation || ''}</textarea>
                    </div>
                    <div class="activity-photos">
                        <label>📸 Photos:</label>
                        <button class="photo-upload-btn" onclick="uploadActivityPhoto('${activityEscaped}')">
                            <span>📷</span> Add Photo
                        </button>
                        <input type="file" id="photo-${activity.replace(/\s+/g, '-')}" 
                               accept="image/*" multiple capture="environment" 
                               style="display: none;" 
                               onchange="handleActivityPhotoUpload('${activityEscaped}', this)">
                        <div class="activity-photo-preview" id="photos-${activity.replace(/\s+/g, '-')}">
                            ${activityData.photos ? activityData.photos.map((photo, photoIndex) => `
                                <div class="activity-photo-item">
                                    <img src="${photo}" alt="Photo">
                                    <button class="activity-photo-remove" 
                                            onclick="removeActivityPhoto('${activityEscaped}', ${photoIndex})">×</button>
                                </div>
                            `).join('') : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    updateStatusCounts();
}

// Update Activity Status with Date Tracking
window.updateActivityStatus = function(activity, status) {
    if (!appState.selectedJunction) {
        showToast('Please select a junction first!', 'error');
        return;
    }
    
    const junctionId = appState.selectedJunction.Location_Id;
    const dateInput = document.getElementById('activityDate');
    const selectedDate = dateInput ? dateInput.value : getTodayDate();
    
    if (!appState.junctionData[junctionId]) {
        appState.junctionData[junctionId] = { activities: {} };
    }
    
    if (!appState.junctionData[junctionId].activities[activity]) {
        appState.junctionData[junctionId].activities[activity] = {
            status: status,
            observation: '',
            photos: [],
            dates: {}
        };
    } else {
        appState.junctionData[junctionId].activities[activity].status = status;
    }
    
    // Initialize dates object if not exists
    if (!appState.junctionData[junctionId].activities[activity].dates) {
        appState.junctionData[junctionId].activities[activity].dates = {};
    }
    
    // Update date stamps based on status
    if (status === 'progress') {
        if (!appState.junctionData[junctionId].activities[activity].dates.progressDate) {
            appState.junctionData[junctionId].activities[activity].dates.progressDate = selectedDate;
        }
        delete appState.junctionData[junctionId].activities[activity].dates.completedDate;
    } else if (status === 'completed') {
        appState.junctionData[junctionId].activities[activity].dates.completedDate = selectedDate;
        if (!appState.junctionData[junctionId].activities[activity].dates.progressDate) {
            appState.junctionData[junctionId].activities[activity].dates.progressDate = selectedDate;
        }
    } else if (status === 'pending') {
        delete appState.junctionData[junctionId].activities[activity].dates.progressDate;
        delete appState.junctionData[junctionId].activities[activity].dates.completedDate;
    }
    
    appState.junctionData[junctionId].lastUpdated = new Date().toISOString();
    
    initializeActivities();
    saveToStorage();
    updateSummaryTab();
    showToast(`${activity} marked as ${status}`, 'success');
}

// Update Activity Observation
window.updateActivityObservation = function(activity, observation) {
    if (!appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    
    if (!appState.junctionData[junctionId].activities[activity]) {
        appState.junctionData[junctionId].activities[activity] = {
            status: 'pending',
            observation: observation,
            photos: [],
            dates: {}
        };
    } else {
        appState.junctionData[junctionId].activities[activity].observation = observation;
    }
    
    saveToStorage();
}

// Upload Activity Photo
window.uploadActivityPhoto = function(activity) {
    const input = document.getElementById(`photo-${activity.replace(/\s+/g, '-')}`);
    if (input) input.click();
}

// Handle Activity Photo Upload
window.handleActivityPhotoUpload = function(activity, input) {
    if (!appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    const files = Array.from(input.files);
    
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(event) {
            if (!appState.junctionData[junctionId].activities[activity]) {
                appState.junctionData[junctionId].activities[activity] = {
                    status: 'pending',
                    observation: '',
                    photos: [],
                    dates: {}
                };
            }
            
            if (!appState.junctionData[junctionId].activities[activity].photos) {
                appState.junctionData[junctionId].activities[activity].photos = [];
            }
            
            appState.junctionData[junctionId].activities[activity].photos.push(event.target.result);
            
            renderActivityPhotos(activity);
            saveToStorage();
            showToast('Photo added to ' + activity, 'success');
        };
        reader.readAsDataURL(file);
    });
}

// Render Activity Photos
function renderActivityPhotos(activity) {
    const junctionId = appState.selectedJunction.Location_Id;
    const photos = appState.junctionData[junctionId]?.activities[activity]?.photos || [];
    const container = document.getElementById(`photos-${activity.replace(/\s+/g, '-')}`);
    
    if (container) {
        const activityEscaped = activity.replace(/'/g, "\\'");
        container.innerHTML = photos.map((photo, index) => `
            <div class="activity-photo-item">
                <img src="${photo}" alt="Photo">
                <button class="activity-photo-remove" 
                        onclick="removeActivityPhoto('${activityEscaped}', ${index})">×</button>
            </div>
        `).join('');
    }
}

// Remove Activity Photo
window.removeActivityPhoto = function(activity, index) {
    if (!appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    appState.junctionData[junctionId].activities[activity].photos.splice(index, 1);
    
    renderActivityPhotos(activity);
    saveToStorage();
    showToast('Photo removed', 'success');
}

// Update Status Counts
function updateStatusCounts() {
    const completedEl = document.getElementById('completedCount');
    const progressEl = document.getElementById('progressCount');
    const pendingEl = document.getElementById('pendingCount');
    
    if (!completedEl || !progressEl || !pendingEl) return;
    
    if (!appState.selectedJunction) {
        completedEl.textContent = '0';
        progressEl.textContent = '0';
        pendingEl.textContent = activities.length;
        return;
    }
    
    const junctionId = appState.selectedJunction.Location_Id;
    const junctionActivities = appState.junctionData[junctionId]?.activities || {};
    
    let completed = 0, progress = 0, pending = 0;
    
    activities.forEach(activity => {
        const status = junctionActivities[activity]?.status || 'pending';
        if (status === 'completed') completed++;
        else if (status === 'progress') progress++;
        else pending++;
    });
    
    completedEl.textContent = completed;
    progressEl.textContent = progress;
    pendingEl.textContent = pending;
}

// Update Summary Tab
function updateSummaryTab() {
    let completedJunctions = 0;
    let inProgressJunctions = 0;
    let notStartedJunctions = 0;
    let totalActivitiesCompleted = 0;
    const totalActivities = junctionData.length * activities.length;
    
    const junctionProgressList = [];
    
    junctionData.forEach(junction => {
        const junctionId = junction.Location_Id;
        const data = appState.junctionData[junctionId];
        
        if (!data || !data.activities || Object.keys(data.activities).length === 0) {
            notStartedJunctions++;
            junctionProgressList.push({ junction, progress: 0 });
        } else {
            const completedCount = Object.values(data.activities).filter(a => a.status === 'completed').length;
            const progressCount = Object.values(data.activities).filter(a => a.status === 'progress').length;
            
            totalActivitiesCompleted += completedCount;
            
            if (completedCount === activities.length) {
                completedJunctions++;
            } else if (completedCount > 0 || progressCount > 0) {
                inProgressJunctions++;
            } else {
                notStartedJunctions++;
            }
            
            junctionProgressList.push({ 
                junction, 
                progress: (completedCount / activities.length) * 100 
            });
        }
    });
    
    // Update statistics
    const totalJunctionsEl = document.getElementById('totalJunctions');
    if (totalJunctionsEl) totalJunctionsEl.textContent = junctionData.length;
    
    const completedJunctionsEl = document.getElementById('completedJunctions');
    if (completedJunctionsEl) completedJunctionsEl.textContent = completedJunctions;
    
    const completedPercentageEl = document.getElementById('completedPercentage');
    if (completedPercentageEl) completedPercentageEl.textContent = 
        `${((completedJunctions / junctionData.length) * 100).toFixed(1)}%`;
    
    const inProgressJunctionsEl = document.getElementById('inProgressJunctions');
    if (inProgressJunctionsEl) inProgressJunctionsEl.textContent = inProgressJunctions;
    
    const progressPercentageEl = document.getElementById('progressPercentage');
    if (progressPercentageEl) progressPercentageEl.textContent = 
        `${((inProgressJunctions / junctionData.length) * 100).toFixed(1)}%`;
    
    const notStartedJunctionsEl = document.getElementById('notStartedJunctions');
    if (notStartedJunctionsEl) notStartedJunctionsEl.textContent = notStartedJunctions;
    
    const notStartedPercentageEl = document.getElementById('notStartedPercentage');
    if (notStartedPercentageEl) notStartedPercentageEl.textContent = 
        `${((notStartedJunctions / junctionData.length) * 100).toFixed(1)}%`;
    
    // Update overall progress bar
    const overallProgress = (totalActivitiesCompleted / totalActivities) * 100;
    const progressBar = document.getElementById('overallProgress');
    if (progressBar) {
        progressBar.style.width = `${overallProgress}%`;
        progressBar.textContent = `${overallProgress.toFixed(1)}%`;
    }
    
    // Update junction list
    const summaryList = document.getElementById('junctionSummaryList');
    if (summaryList) {
        junctionProgressList.sort((a, b) => b.progress - a.progress);
        
        summaryList.innerHTML = junctionProgressList.map(item => `
            <div class="junction-summary-item" onclick="selectJunctionFromSummary(${item.junction.Location_Id})">
                <div class="junction-summary-name">
                    ${item.junction.Name}
                </div>
                <div class="junction-summary-progress">
                    <div class="mini-progress-bar">
                        <div class="mini-progress-fill" style="width: ${item.progress}%"></div>
                    </div>
                    <span class="junction-percentage">${item.progress.toFixed(0)}%</span>
                </div>
            </div>
        `).join('');
    }
}

// Select Junction from Summary
window.selectJunctionFromSummary = function(locationId) {
    const junction = junctionData.find(j => j.Location_Id == locationId);
    if (junction) {
        // Switch to junction tab
        document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelector('[data-tab="junction"]').classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById('junction-tab').classList.add('active');
        
        // Select the junction
        selectJunction(junction);
    }
}

// Tab Navigation
function initializeEventListeners() {
    // Tab switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            
            // Update active tab
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // Update tab content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            const tabContent = document.getElementById(`${tabName}-tab`);
            if (tabContent) tabContent.classList.add('active');
            
            // Update summary when switching to summary tab
            if (tabName === 'summary') {
                updateSummaryTab();
            }
            
            // Update current junction banner when switching to activities
            if (tabName === 'activities') {
                updateCurrentJunctionBanner();
            }
        });
    });
    
    // Junction search
    const searchInput = document.getElementById('junctionSearch');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            const searchTerm = e.target.value.toLowerCase();
            const filtered = junctionData.filter(junction => 
                junction.Name.toLowerCase().includes(searchTerm) ||
                junction.Location_Id.toString().includes(searchTerm) ||
                junction.Corridors_Name.toLowerCase().includes(searchTerm)
            );
            renderJunctionList(filtered);
        });
    }
}

// Date Helper Functions
function getTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

window.setToday = function() {
    const dateInput = document.getElementById('activityDate');
    if (dateInput) dateInput.value = getTodayDate();
}

window.setReportDatesToday = function() {
    const today = getTodayDate();
    const fromDateInput = document.getElementById('reportFromDate');
    const toDateInput = document.getElementById('reportToDate');
    if (fromDateInput) fromDateInput.value = today;
    if (toDateInput) toDateInput.value = today;
}

window.setReportDatesWeek = function() {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + (6 - weekEnd.getDay()));
    
    const fromDateInput = document.getElementById('reportFromDate');
    const toDateInput = document.getElementById('reportToDate');
    if (fromDateInput) fromDateInput.value = formatDateForInput(weekStart);
    if (toDateInput) toDateInput.value = formatDateForInput(weekEnd);
}

function formatDateForInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
    });
}

// Helper function to check if date is in range
function isDateInRange(dateToCheck, fromDate, toDate) {
    const check = new Date(dateToCheck);
    const from = new Date(fromDate);
    const to = new Date(toDate);
    
    check.setHours(0, 0, 0, 0);
    from.setHours(0, 0, 0, 0);
    to.setHours(0, 0, 0, 0);
    
    return check >= from && check <= to;
}

// Save Draft
window.saveDraft = function() {
    saveToStorage();
    showToast('Draft saved locally!', 'success');
}

// Submit Inspection
window.submitInspection = async function() {
    if (!appState.selectedJunction) {
        showToast('Please select a junction first!', 'error');
        return;
    }
    
    const junctionId = appState.selectedJunction.Location_Id;
    appState.junctionData[junctionId].submittedAt = new Date().toISOString();
    
    const inspectionData = {
        junction: appState.selectedJunction,
        activities: appState.junctionData[junctionId].activities,
        submittedAt: appState.junctionData[junctionId].submittedAt,
        inspector: 'PMC Engineer'
    };
    
    console.log('Submitting inspection:', inspectionData);
    
    showSpinner(true);
    
    setTimeout(() => {
        showSpinner(false);
        saveToStorage();
        updateSummaryTab();
        renderJunctionList(junctionData);
        showToast(`Inspection report for Junction ${junctionId} submitted successfully!`, 'success');
    }, 2000);
}

// Generate Daily Report
window.generateDailyReport = function() {
    const fromDate = document.getElementById('reportFromDate')?.value || getTodayDate();
    const toDate = document.getElementById('reportToDate')?.value || getTodayDate();
    
    let reportContent = `CHENNAI ITS - INSPECTION REPORT\n`;
    reportContent += `=====================================\n`;
    reportContent += `Date Range: ${formatDate(fromDate)} to ${formatDate(toDate)}\n\n`;
    
    let hasData = false;
    let totalActivitiesStarted = 0;
    let totalActivitiesCompleted = 0;
    
    junctionData.forEach(junction => {
        const junctionId = junction.Location_Id;
        const data = appState.junctionData[junctionId];
        
        if (data && data.activities) {
            let junctionHasData = false;
            let junctionContent = `\nJUNCTION: ${junction.Name}\n`;
            junctionContent += `ID: ${junctionId} | Corridor: ${junction.Corridors_Name}\n`;
            junctionContent += `-----------------------------------------\n`;
            
            activities.forEach(activity => {
                const actData = data.activities[activity];
                if (actData && actData.dates) {
                    let activityInRange = false;
                    let activityLine = '';
                    
                    if (actData.dates.progressDate && isDateInRange(actData.dates.progressDate, fromDate, toDate)) {
                        activityInRange = true;
                        totalActivitiesStarted++;
                        activityLine += `🔄 ${activity}: Started on ${formatDate(actData.dates.progressDate)}`;
                    }
                    
                    if (actData.dates.completedDate && isDateInRange(actData.dates.completedDate, fromDate, toDate)) {
                        activityInRange = true;
                        totalActivitiesCompleted++;
                        if (activityLine) {
                            activityLine = `✅ ${activity}: Started on ${formatDate(actData.dates.progressDate)}, Completed on ${formatDate(actData.dates.completedDate)}`;
                        } else {
                            activityLine = `✅ ${activity}: Completed on ${formatDate(actData.dates.completedDate)}`;
                        }
                    }
                    
                    if (activityInRange) {
                        junctionHasData = true;
                        junctionContent += activityLine + '\n';
                        
                        if (actData.observation) {
                            junctionContent += `   Notes: ${actData.observation}\n`;
                        }
                        if (actData.photos && actData.photos.length > 0) {
                            junctionContent += `   Photos: ${actData.photos.length} attached\n`;
                        }
                    }
                }
            });
            
            if (junctionHasData) {
                hasData = true;
                reportContent += junctionContent;
            }
        }
    });
    
    if (!hasData) {
        showToast('No inspection data available for selected date range', 'error');
        return;
    }
    
    reportContent += `\n=====================================\n`;
    reportContent += `SUMMARY\n`;
    reportContent += `Activities Started: ${totalActivitiesStarted}\n`;
    reportContent += `Activities Completed: ${totalActivitiesCompleted}\n`;
    
    const filename = `CITS_Report_${fromDate}_to_${toDate}.txt`;
    downloadReport(reportContent, filename);
    showToast('Report generated successfully!', 'success');
}

// Generate Weekly Report
window.generateWeeklyReport = function() {
    const fromDate = document.getElementById('reportFromDate')?.value;
    const toDate = document.getElementById('reportToDate')?.value;
    
    let weekStart, weekEnd;
    if (fromDate && toDate) {
        weekStart = new Date(fromDate);
        weekEnd = new Date(toDate);
    } else {
        weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekEnd = new Date();
        weekEnd.setDate(weekEnd.getDate() + (6 - weekEnd.getDay()));
    }
    
    let reportContent = `CHENNAI ITS - WEEKLY SUMMARY REPORT\n`;
    reportContent += `====================================\n`;
    reportContent += `Week: ${formatDate(formatDateForInput(weekStart))} - ${formatDate(formatDateForInput(weekEnd))}\n\n`;
    
    let weeklyJunctions = 0;
    let weeklyActivitiesStarted = 0;
    let weeklyActivitiesCompleted = 0;
    const junctionProgress = [];
    
    junctionData.forEach(junction => {
        const junctionId = junction.Location_Id;
        const data = appState.junctionData[junctionId];
        
        if (data && data.activities) {
            let junctionStarted = 0;
            let junctionCompleted = 0;
            
            Object.values(data.activities).forEach(activity => {
                if (activity.dates) {
                    if (activity.dates.progressDate && 
                        isDateInRange(activity.dates.progressDate, formatDateForInput(weekStart), formatDateForInput(weekEnd))) {
                        weeklyActivitiesStarted++;
                        junctionStarted++;
                    }
                    if (activity.dates.completedDate && 
                        isDateInRange(activity.dates.completedDate, formatDateForInput(weekStart), formatDateForInput(weekEnd))) {
                        weeklyActivitiesCompleted++;
                        junctionCompleted++;
                    }
                }
            });
            
            if (junctionStarted > 0 || junctionCompleted > 0) {
                weeklyJunctions++;
                junctionProgress.push({
                    name: junction.Name,
                    id: junctionId,
                    started: junctionStarted,
                    completed: junctionCompleted,
                    progress: (junctionCompleted / activities.length * 100).toFixed(1)
                });
            }
        }
    });
    
    reportContent += `SUMMARY\n`;
    reportContent += `-------\n`;
    reportContent += `Total Junctions with Activity: ${weeklyJunctions}\n`;
    reportContent += `Activities Started: ${weeklyActivitiesStarted}\n`;
    reportContent += `Activities Completed: ${weeklyActivitiesCompleted}\n\n`;
    
    if (junctionProgress.length > 0) {
        reportContent += `JUNCTION-WISE DETAILS\n`;
        reportContent += `--------------------\n`;
        
        junctionProgress.sort((a, b) => b.completed - a.completed);
        
        junctionProgress.forEach(jp => {
            reportContent += `\n${jp.name}\n`;
            reportContent += `ID: ${jp.id} | Progress: ${jp.progress}%\n`;
            reportContent += `Started: ${jp.started} activities | Completed: ${jp.completed} activities\n`;
        });
    }
    
    downloadReport(reportContent, `CITS_Weekly_Report_${formatDateForInput(weekStart)}.txt`);
    showToast('Weekly report generated successfully!', 'success');
}

// Export All Data with Dates
window.exportAllData = function() {
    let csvContent = 'Junction ID,Junction Name,Corridor,Activity,Status,Progress Date,Completed Date,Observation,Photos Count,Last Updated\n';
    
    junctionData.forEach(junction => {
        const junctionId = junction.Location_Id;
        const data = appState.junctionData[junctionId];
        
        if (data && data.activities) {
            activities.forEach(activity => {
                const actData = data.activities[activity] || { 
                    status: 'pending', 
                    observation: '', 
                    photos: [], 
                    dates: {} 
                };
                
                csvContent += `${junctionId},`;
                csvContent += `"${junction.Name}",`;
                csvContent += `"${junction.Corridors_Name}",`;
                csvContent += `"${activity}",`;
                csvContent += `${actData.status || 'pending'},`;
                csvContent += `${actData.dates?.progressDate || ''},`;
                csvContent += `${actData.dates?.completedDate || ''},`;
                csvContent += `"${actData.observation || ''}",`;
                csvContent += `${actData.photos ? actData.photos.length : 0},`;
                csvContent += `${data.lastUpdated || ''}\n`;
            });
        } else {
            activities.forEach(activity => {
                csvContent += `${junctionId},`;
                csvContent += `"${junction.Name}",`;
                csvContent += `"${junction.Corridors_Name}",`;
                csvContent += `"${activity}",`;
                csvContent += `pending,`;
                csvContent += `,`;
                csvContent += `,`;
                csvContent += `"",`;
                csvContent += `0,`;
                csvContent += `\n`;
            });
        }
    });
    
    downloadReport(csvContent, `CITS_Complete_Data_${getTodayDate()}.csv`);
    showToast('Complete data exported successfully!', 'success');
}

// Download Report
function downloadReport(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Utility Functions
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) {
        console.log(message);
        return;
    }
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function showSpinner(show) {
    const spinner = document.getElementById('spinner');
    if (spinner) {
        spinner.style.display = show ? 'block' : 'none';
    }
}

// Check Online Status
function checkOnlineStatus() {
    const updateOnlineStatus = () => {
        const syncStatus = document.querySelector('.sync-status span:last-child');
        const syncIndicator = document.querySelector('.sync-indicator');
        const offlineIndicator = document.getElementById('offlineIndicator');
        
        if (navigator.onLine) {
            if (syncStatus) syncStatus.textContent = 'Online';
            if (syncIndicator) syncIndicator.style.background = '#10b981';
            if (offlineIndicator) offlineIndicator.classList.remove('show');
        } else {
            if (syncStatus) syncStatus.textContent = 'Offline';
            if (syncIndicator) syncIndicator.style.background = '#f59e0b';
            if (offlineIndicator) offlineIndicator.classList.add('show');
        }
    };
    
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
}

// PWA Installation
function initializePWA() {
    let deferredPrompt;
    const installBtn = document.getElementById('installBtn');
    
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installBtn) installBtn.classList.add('show');
    });
    
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            
            if (outcome === 'accepted') {
                showToast('App installed successfully!', 'success');
            }
            
            deferredPrompt = null;
            installBtn.classList.remove('show');
        });
    }
}

// Service Worker Registration (for PWA)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        console.log('Service Worker support detected');
    });
}