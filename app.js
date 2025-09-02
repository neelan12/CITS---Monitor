// app.js - Complete Application with Firebase Firestore
// PART 1 OF 2 - Copy this and app-part2.js into a single app.js file

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCj_BqxY1zs5H4uCYWWbimm-BdAM5rsZ_Q",
    authDomain: "cits-monitor.firebaseapp.com",
    projectId: "cits-monitor",
    storageBucket: "cits-monitor.firebasestorage.app",
    messagingSenderId: "1064934816079",
    appId: "1:1064934816079:web:08b3407dda4a6571926d3a"
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization error:', error);
}

const db = firebase.firestore();

// Enable offline persistence
db.enablePersistence()
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('Multiple tabs open, persistence can only be enabled in one tab at a time.');
        } else if (err.code == 'unimplemented') {
            console.log('The current browser does not support offline persistence');
        }
    });

// App State
let appState = {
    selectedJunction: null,
    junctionData: {},
    currentLocation: null,
    map: null,
    markers: {
        junction: null,
        current: null
    },
    unsubscribers: []
};

// Firestore Functions
async function loadFromFirestore() {
    try {
        console.log('Loading data from Firestore...');
        const snapshot = await db.collection('inspections').get();
        
        appState.junctionData = {};
        snapshot.forEach(doc => {
            const junctionId = doc.id.replace('junction-', '');
            appState.junctionData[junctionId] = doc.data();
        });
        
        console.log('Loaded junction data:', Object.keys(appState.junctionData).length, 'junctions');
        setupRealtimeListeners();
        
    } catch (error) {
        console.error('Error loading from Firestore:', error);
        appState.junctionData = {};
        showToast('Starting in offline mode', 'warning');
    }
}

async function saveToFirestore(junctionId = null) {
    try {
        if (junctionId && appState.junctionData[junctionId]) {
            const docRef = db.collection('inspections').doc(`junction-${junctionId}`);
            await docRef.set(appState.junctionData[junctionId]);
            console.log('Saved junction data for:', junctionId);
        } else if (Object.keys(appState.junctionData).length > 0) {
            const batch = db.batch();
            Object.keys(appState.junctionData).forEach(juncId => {
                const docRef = db.collection('inspections').doc(`junction-${juncId}`);
                batch.set(docRef, appState.junctionData[juncId]);
            });
            await batch.commit();
            console.log('Saved all junction data');
        }
    } catch (error) {
        console.error('Error saving to Firestore:', error);
        showToast('Error saving data. Will retry when online.', 'warning');
    }
}

function setupRealtimeListeners() {
    try {
        appState.unsubscribers.forEach(unsubscribe => unsubscribe());
        appState.unsubscribers = [];
        
        const unsubscribe = db.collection('inspections').onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const junctionId = change.doc.id.replace('junction-', '');
                
                if (change.type === 'added' || change.type === 'modified') {
                    const remoteData = change.doc.data();
                    const localData = appState.junctionData[junctionId];
                    
                    if (!localData || !localData.lastUpdated || 
                        (remoteData.lastUpdated && new Date(remoteData.lastUpdated) > new Date(localData.lastUpdated))) {
                        
                        appState.junctionData[junctionId] = remoteData;
                        
                        if (appState.selectedJunction && appState.selectedJunction.Location_Id == junctionId) {
                            initializeActivities();
                            updateStatusCounts();
                        }
                        
                        updateSummaryTab();
                        renderJunctionList(junctionData);
                        console.log('Updated junction data from Firestore:', junctionId);
                    }
                } else if (change.type === 'removed') {
                    delete appState.junctionData[junctionId];
                }
            });
        }, (error) => {
            console.error('Error in real-time listener:', error);
        });
        
        appState.unsubscribers.push(unsubscribe);
    } catch (error) {
        console.error('Error setting up listeners:', error);
    }
}

// Initialize App
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded, initializing app...');
    
    if (typeof junctionData === 'undefined') {
        console.error('Junction data not loaded! Check junction-data.js file');
        alert('Error: Junction data not found. Please check junction-data.js file.');
        return;
    }
    
    if (typeof activities === 'undefined') {
        console.error('Activities data not loaded! Check junction-data.js file');
        alert('Error: Activities data not found. Please check junction-data.js file.');
        return;
    }
    
    console.log('Data files loaded correctly');
    
    try {
        await loadFromFirestore();
        initializeJunctionList();
        initializeEventListeners();
        initializeMap();
        checkOnlineStatus();
        initializePWA();
        updateSummaryTab();
        setToday();
        
        if (appState.selectedJunction) {
            selectJunction(appState.selectedJunction);
        }
        
        console.log('App initialization complete');
    } catch (error) {
        console.error('Error during app initialization:', error);
        showToast('Error initializing app', 'error');
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
    
    if (!appState.junctionData[junction.Location_Id]) {
        appState.junctionData[junction.Location_Id] = {
            activities: {},
            lastUpdated: null,
            submittedAt: null
        };
    }
    
    document.querySelectorAll('.junction-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    const junctions = document.querySelectorAll('.junction-item');
    junctions.forEach(item => {
        if (item.querySelector('.junction-id').textContent == junction.Location_Id) {
            item.classList.add('selected');
        }
    });
    
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
        
        updateMap(junction);
        
        const mapEl = document.getElementById('map');
        if (mapEl) mapEl.classList.add('show');
        
        initializeActivities();
        updateCurrentJunctionBanner();
    }
    
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

// END OF PART 1 - Continue with app-part2.js

// app.js - Complete Application with Firebase Firestore
// PART 2 OF 2 - Merge this with app-part1.js into a single app.js file

// Initialize Activities
function initializeActivities() {
    const activitySection = document.getElementById('activitySection');
    if (!activitySection || !appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    const junctionActivities = appState.junctionData[junctionId]?.activities || {};
    
    activitySection.innerHTML = `
        <div class="activity-progress-table-section">
            <div class="activity-progress-table-header">
                <div class="activity-progress-table-cell activity-label-header">Activity</div>
                <div class="activity-progress-table-cell">Work Status</div>
                <div class="activity-progress-table-cell">Start Date</div>
                <div class="activity-progress-table-cell">End Date</div>
                <div class="activity-progress-table-cell">Actions</div>
            </div>
            ${activities.map((activity, index) => {
        const activityData = junctionActivities[activity] || { 
            status: 'pending', 
            observation: '', 
            photos: [], 
            dates: {},
                    quantities: {}
                };
        
        const activityEscaped = activity.replace(/'/g, "\\'");
                const startDate = activityData.dates?.progressDate ? formatDate(activityData.dates.progressDate) : '';
                const endDate = activityData.dates?.completedDate ? formatDate(activityData.dates.completedDate) : '';
        
        return `
                    <div class="activity-progress-table-row">
                        <div class="activity-progress-table-cell activity-label">
                            <span class="activity-icon">📋</span>
                    <span class="activity-name">${activity}</span>
                    <span class="activity-number">${index + 1}/${activities.length}</span>
                </div>
                        <div class="activity-progress-table-cell status-cell">
                            <div class="status-selector-compact">
                                <button class="status-btn-compact completed ${activityData.status === 'completed' ? 'selected' : ''}" 
                                        onclick="updateActivityStatus('${activityEscaped}', 'completed')" title="Completed">
                                    ✅
                    </button>
                                <button class="status-btn-compact progress ${activityData.status === 'progress' ? 'selected' : ''}" 
                                        onclick="updateActivityStatus('${activityEscaped}', 'progress')" title="In Progress">
                                    🔄
                    </button>
                                <button class="status-btn-compact pending ${activityData.status === 'pending' ? 'selected' : ''}" 
                                        onclick="updateActivityStatus('${activityEscaped}', 'pending')" title="Yet to Start">
                                    ⏳
                    </button>
                            </div>
                        </div>
                        <div class="activity-progress-table-cell date-cell">
                            <span class="date-display">${startDate || 'Not started'}</span>
                        </div>
                        <div class="activity-progress-table-cell date-cell">
                            <span class="date-display">${endDate || 'Not completed'}</span>
                        </div>
                        <div class="activity-progress-table-cell actions-cell">
                            <button class="action-btn details-btn" onclick="toggleActivityDetails('${activityEscaped}')" title="View Details">
                                📊 Details
                            </button>
                        </div>
                </div>
                
                    <!-- Collapsible Details Section -->
                    <div class="activity-details-section" id="details-${activity.replace(/\s+/g, '-')}" style="display: none;">
                        <div class="details-content">
                            <!-- Quantity Tracking Section -->
                            <div class="quantity-tracking-section">
                                <div class="quantity-header">
                                    <h4>📊 Quantity Comparison</h4>
                                    <span class="quantity-subtitle">Compare site quantities with contractor submissions</span>
                    </div>
                    
                                ${generateQuantityFields(activity, activityData)}
                                
                                <!-- Quantity Comparison Summary -->
                                <div class="quantity-summary" id="quantity-summary-${activity.replace(/\s+/g, '-')}">
                                    ${generateQuantitySummary(activityData.quantities)}
                                </div>
                                </div>
                                
                            <!-- Activity Notes -->
                            <div class="activity-extras">
                                <div class="observation-section">
                                            <div class="observation-header">
                                        <h4>📝 Observations</h4>
                                        <button class="add-observation-btn" onclick="addObservation('${activityEscaped}')">
                                            <span>➕</span> Add Observation
                                        </button>
                                            </div>
                                            
                                    <div class="observation-table-section">
                                        <div class="observation-table-header">
                                            <div class="observation-table-cell">Observation Comments</div>
                                            <div class="observation-table-cell">Photos</div>
                                            <div class="observation-table-cell">Status</div>
                                            <div class="observation-table-cell">Actions</div>
                                                                    </div>
                                        <div class="observation-table-body" id="observations-${activity.replace(/\s+/g, '-')}">
                                            ${generateObservationsTable(activity, activityData)}
                                                                </div>
                                                        </div>
                                                    </div>
                                            </div>
                                            </div>
                                        </div>
                `;
            }).join('')}
                                    </div>
    `;
    
    updateStatusCounts();
}

// Generate Observations Table
function generateObservationsTable(activity, activityData) {
    const observations = activityData.observations || [];
    
    if (observations.length === 0) {
        return `
            <div class="observation-table-row empty-row">
                <div class="observation-table-cell" colspan="4">
                    <span class="no-observations">No observations added yet. Click "Add Observation" to get started.</span>
                                            </div>
            </div>
        `;
    }
    
    return observations.map((observation, index) => {
        const isClosed = observation.status === 'closed';
        const rowClass = isClosed ? 'observation-table-row closed' : 'observation-table-row';
        
        return `
            <div class="${rowClass}" id="observation-row-${activity.replace(/\s+/g, '-')}-${index}">
                <div class="observation-table-cell comments-cell">
                    <textarea 
                        class="observation-comment" 
                        placeholder="Enter observation details..."
                        onchange="updateObservationComment('${activity.replace(/'/g, "\\'")}', ${index}, this.value)"
                        ${isClosed ? 'disabled' : ''}
                    >${observation.comment || ''}</textarea>
                </div>
                <div class="observation-table-cell photos-cell">
                    <div class="observation-photos">
                        <div class="observation-photo-preview">
                            ${observation.photos && observation.photos.length > 0 ? observation.photos.map((photo, photoIndex) => `
                                <div class="observation-photo-item" onclick="openPhotoPreview('${activity.replace(/'/g, "\\'")}', ${photoIndex}, '${photo}', 'observation', ${index})">
                                    <img src="${photo}" alt="Photo">
                                                                        <div class="photo-overlay">
                                                                            <span class="photo-view-icon">👁</span>
                                                                        </div>
                                                                    </div>
                            `).join('') : '<span class="no-photos">No photos</span>'}
                                                            </div>
                                                        </div>
                                                </div>
                <div class="observation-table-cell status-cell">
                    <button class="status-toggle-btn ${isClosed ? 'closed' : 'open'}" 
                            onclick="toggleObservationStatus('${activity.replace(/'/g, "\\'")}', ${index})">
                        ${isClosed ? '🔒 Closed' : '🔓 Open'}
                                                </button>
                                            </div>
                <div class="observation-table-cell actions-cell">
                    <button class="delete-observation-btn" onclick="deleteObservation('${activity.replace(/'/g, "\\'")}', ${index})" title="Delete Observation">
                        🗑️
                                            </button>
                                        </div>
                                </div>
        `;
    }).join('');
}

// Add New Observation
window.addObservation = async function(activity) {
    // Create and show the popup
    const popupHTML = `
        <div class="observation-popup-overlay" id="observation-popup-overlay">
            <div class="observation-popup">
                <div class="observation-popup-header">
                    <h3>➕ Add New Observation</h3>
                    <button class="close-popup-btn" onclick="closeObservationPopup()">✕</button>
                            </div>
                <div class="observation-popup-content">
                    <div class="observation-input-group">
                        <label>📝 Observation Comments:</label>
                        <textarea 
                            id="new-observation-comment" 
                            placeholder="Enter observation details..."
                            rows="4"
                        ></textarea>
                    </div>
                    <div class="observation-input-group">
    			<label>📸 Photos:</label>
                        <div class="photo-upload-section">
                            <button class="add-photo-popup-btn" onclick="showObservationPhotoOptionsPopup()">
        			<span>📷</span> Add Photo
    			</button>
                            <input type="file" id="observation-photo-camera-popup" 
           			accept="image/*" capture="environment" 
           			style="display: none;" 
                                   onchange="handleObservationPhotoUploadPopup(this)">
                            <input type="file" id="observation-photo-gallery-popup" 
           accept="image/*" multiple 
           style="display: none;" 
                                   onchange="handleObservationPhotoUploadPopup(this)">
                            <div class="observation-photo-preview-popup" id="observation-photo-preview-popup">
                                <!-- Photos will be added here -->
            </div>
        </div>
</div>
                </div>
                <div class="observation-popup-footer">
                    <button class="cancel-btn" onclick="closeObservationPopup()">Cancel</button>
                    <button class="add-btn" onclick="saveNewObservation('${activity.replace(/'/g, "\\'")}')">Add Observation</button>
                    </div>
                </div>
            </div>
        `;
    
    // Add popup to body
    document.body.insertAdjacentHTML('beforeend', popupHTML);
    
    // Store activity for later use
    window.currentObservationActivity = activity;
    window.currentObservationPhotos = [];
}

// Close Observation Popup
window.closeObservationPopup = function() {
    const popup = document.getElementById('observation-popup-overlay');
    if (popup) {
        popup.remove();
    }
    // Clear stored data
    window.currentObservationActivity = null;
    window.currentObservationPhotos = [];
}

// Show Observation Photo Options in Popup
window.showObservationPhotoOptionsPopup = function() {
    // Check if it's a mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
        // For mobile devices, show a modern modal with buttons
        const modalHTML = `
            <div class="photo-options-modal" id="photo-options-modal" style="display: flex;">
                <div class="photo-options-content">
                    <div class="photo-options-title">Choose Photo Source</div>
                    <button class="photo-option-btn" onclick="selectPhotoSource('camera')">
                        <span class="icon">📷</span>
                        <span>Take Photo</span>
                    </button>
                    <button class="photo-option-btn" onclick="selectPhotoSource('gallery')">
                        <span class="icon">🖼️</span>
                        <span>Choose from Gallery</span>
                    </button>
                    <button class="photo-cancel-btn" onclick="closePhotoOptionsModal()">Cancel</button>
                </div>
            </div>
        `;
        
        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    } else {
        // For desktop/laptop, directly open file picker
        const galleryInput = document.getElementById('observation-photo-gallery-popup');
        if (galleryInput) {
            galleryInput.click();
        }
    }
}

// Select Photo Source
window.selectPhotoSource = function(source) {
    const cameraInput = document.getElementById('observation-photo-camera-popup');
    const galleryInput = document.getElementById('observation-photo-gallery-popup');
    
    if (source === 'camera' && cameraInput) {
        cameraInput.click();
    } else if (source === 'gallery' && galleryInput) {
        galleryInput.click();
    }
    
    // Close the modal
    closePhotoOptionsModal();
}

// Close Photo Options Modal
window.closePhotoOptionsModal = function() {
    const modal = document.getElementById('photo-options-modal');
    if (modal) {
        modal.remove();
    }
}

// Handle Observation Photo Upload in Popup
window.handleObservationPhotoUploadPopup = async function(input) {
    const files = input.files;
    
    if (files.length > 0) {
        // Show loading indicator
        const previewContainer = document.getElementById('observation-photo-preview-popup');
        if (previewContainer) {
            previewContainer.innerHTML = '<div class="uploading-photos">📸 Uploading photos...</div>';
        }
        
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                console.log('Uploading file:', file.name);
                
                const photoUrl = await uploadPhotoToFirebase(file);
                console.log('Uploaded photo URL:', photoUrl);
                
                // Add to current observation photos
                if (!window.currentObservationPhotos) {
                    window.currentObservationPhotos = [];
                }
                window.currentObservationPhotos.push(photoUrl);
            }
            
            // Update preview after all uploads complete
            updateObservationPhotoPreviewPopup();
            
        } catch (error) {
            console.error('Error uploading photos:', error);
            alert('Error uploading photos. Please try again.');
            
            // Reset preview to show existing photos
            updateObservationPhotoPreviewPopup();
        }
    }
    
    // Reset input
    input.value = '';
}

// Update Observation Photo Preview in Popup
window.updateObservationPhotoPreviewPopup = function() {
    const previewContainer = document.getElementById('observation-photo-preview-popup');
    if (previewContainer && window.currentObservationPhotos) {
        previewContainer.innerHTML = window.currentObservationPhotos.map((photo, index) => `
            <div class="observation-photo-item-popup" onclick="openPhotoPreview('observation-popup', ${index}, '${photo}')">
                <img src="${photo}" alt="Photo">
                <div class="photo-overlay">
                    <span class="photo-view-icon">👁</span>
                </div>
                <button class="remove-photo-btn" onclick="removeObservationPhoto(${index})" title="Remove Photo">✕</button>
            </div>
        `).join('');
    }
}

// Remove Observation Photo
window.removeObservationPhoto = function(index) {
    if (window.currentObservationPhotos) {
        window.currentObservationPhotos.splice(index, 1);
        updateObservationPhotoPreviewPopup();
    }
}

// Save New Observation
window.saveNewObservation = async function(activity) {
    if (!appState.selectedJunction) return;
    
    const comment = document.getElementById('new-observation-comment').value.trim();
    
    if (!comment) {
        alert('Please enter observation comments before adding.');
        return;
    }
    
    const junctionId = appState.selectedJunction.Location_Id;
    
    if (!appState.junctionData[junctionId].activities[activity].observations) {
        appState.junctionData[junctionId].activities[activity].observations = [];
    }
    
    const newObservation = {
        id: Date.now(),
        comment: comment,
        photos: window.currentObservationPhotos || [],
        status: 'open',
        createdAt: new Date().toISOString()
    };
    
    appState.junctionData[junctionId].activities[activity].observations.push(newObservation);
    
    // Refresh the observations table
    const observationsBody = document.getElementById(`observations-${activity.replace(/\s+/g, '-')}`);
    if (observationsBody) {
        observationsBody.innerHTML = generateObservationsTable(activity, appState.junctionData[junctionId].activities[activity]);
    }
    
    await saveToFirestore(junctionId);
    
    // Close popup
    closeObservationPopup();
}

// Update Observation Comment
window.updateObservationComment = async function(activity, index, comment) {
    if (!appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    appState.junctionData[junctionId].activities[activity].observations[index].comment = comment;
    
    await saveToFirestore(junctionId);
}

// Toggle Observation Status
window.toggleObservationStatus = async function(activity, index) {
    if (!appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    const observation = appState.junctionData[junctionId].activities[activity].observations[index];
    
    observation.status = observation.status === 'open' ? 'closed' : 'open';
    
    // Refresh the observations table
    const observationsBody = document.getElementById(`observations-${activity.replace(/\s+/g, '-')}`);
    if (observationsBody) {
        observationsBody.innerHTML = generateObservationsTable(activity, appState.junctionData[junctionId].activities[activity]);
    }
    
    await saveToFirestore(junctionId);
}

// Delete Observation
window.deleteObservation = async function(activity, index) {
    if (!appState.selectedJunction) return;
    
    if (confirm('Are you sure you want to delete this observation?')) {
        const junctionId = appState.selectedJunction.Location_Id;
        appState.junctionData[junctionId].activities[activity].observations.splice(index, 1);
        
        // Refresh the observations table
        const observationsBody = document.getElementById(`observations-${activity.replace(/\s+/g, '-')}`);
        if (observationsBody) {
            observationsBody.innerHTML = generateObservationsTable(activity, appState.junctionData[junctionId].activities[activity]);
        }
        
        await saveToFirestore(junctionId);
    }
}

// Show Observation Photo Options
window.showObservationPhotoOptions = function(activity, index) {
    const cameraInput = document.getElementById(`observation-photo-camera-${activity.replace(/\s+/g, '-')}-${index}`);
    const galleryInput = document.getElementById(`observation-photo-gallery-${activity.replace(/\s+/g, '-')}-${index}`);
    
    if (cameraInput && galleryInput) {
        const options = ['📷 Camera', '🖼️ Gallery'];
        const choice = prompt(`Choose photo source:\n1. ${options[0]}\n2. ${options[1]}\n\nEnter 1 or 2:`);
        
        if (choice === '1') {
            cameraInput.click();
        } else if (choice === '2') {
            galleryInput.click();
        }
    }
}

// Handle Observation Photo Upload
window.handleObservationPhotoUpload = async function(activity, index, input) {
    if (!appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    const files = input.files;
    
    if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const photoUrl = await uploadPhotoToFirebase(file);
            
            if (!appState.junctionData[junctionId].activities[activity].observations[index].photos) {
                appState.junctionData[junctionId].activities[activity].observations[index].photos = [];
            }
            
            appState.junctionData[junctionId].activities[activity].observations[index].photos.push(photoUrl);
        }
        
        // Refresh the observations table
        const observationsBody = document.getElementById(`observations-${activity.replace(/\s+/g, '-')}`);
        if (observationsBody) {
            observationsBody.innerHTML = generateObservationsTable(activity, appState.junctionData[junctionId].activities[activity]);
        }
        
        await saveToFirestore(junctionId);
    }
    
    // Reset input
    input.value = '';
}
window.toggleActivityDetails = function(activity) {
    const detailsSection = document.getElementById(`details-${activity.replace(/\s+/g, '-')}`);
    if (detailsSection) {
        const isVisible = detailsSection.style.display !== 'none';
        detailsSection.style.display = isVisible ? 'none' : 'block';
        
        // Update button text
        const button = event.target;
        if (button) {
            button.innerHTML = isVisible ? '📊 Details' : '📊 Hide Details';
        }
    }
}
window.updateActivityStatus = async function(activity, status) {
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
            dates: {},
            quantities: {}
        };
    } else {
        appState.junctionData[junctionId].activities[activity].status = status;
    }
    
    if (!appState.junctionData[junctionId].activities[activity].dates) {
        appState.junctionData[junctionId].activities[activity].dates = {};
    }
    
    
    
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
    await saveToFirestore(junctionId);
    updateSummaryTab();
    showToast(`${activity} marked as ${status}`, 'success');
}



// Advanced Image Compression Function
async function compressImageTo100KB(file) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = () => {
            // Function to try compression with specific settings
            const tryCompression = (width, height, quality) => {
                return new Promise(resolve => {
                    // Calculate dimensions maintaining aspect ratio
                    const aspectRatio = img.width / img.height;
                    let canvasWidth = width;
                    let canvasHeight = height;
                    
                    if (aspectRatio > 1) {
                        // Landscape
                        canvasHeight = Math.floor(width / aspectRatio);
                    } else {
                        // Portrait  
                        canvasWidth = Math.floor(height * aspectRatio);
                    }
                    
                    canvas.width = canvasWidth;
                    canvas.height = canvasHeight;
                    
                    // Use high-quality scaling
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    
                    // Clear and draw
                    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
                    ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
                    
                    canvas.toBlob(resolve, 'image/jpeg', quality);
                });
            };
            
            // Iterative compression to target 100KB
            const compressIteratively = async () => {
                let targetWidth = Math.min(1200, img.width);
                let targetHeight = Math.min(900, img.height);
                let quality = 0.85;
                
                for (let attempt = 0; attempt < 10; attempt++) {
                    const blob = await tryCompression(targetWidth, targetHeight, quality);
                    const sizeKB = blob.size / 1024;
                    
                    console.log(`Compression attempt ${attempt + 1}: ${sizeKB.toFixed(1)}KB (${targetWidth}x${targetHeight} @ ${Math.round(quality*100)}%)`);
                    
                    if (sizeKB <= 100) {
                        console.log(`SUCCESS: Compressed ${(file.size/1024/1024).toFixed(2)}MB to ${sizeKB.toFixed(1)}KB`);
                        resolve(blob);
                        return;
                    }
                    
                    // Intelligent adjustment based on current size
                    const ratio = 100 / sizeKB;
                    
                    if (sizeKB > 300) {
                        // Very large, reduce dimensions aggressively
                        targetWidth = Math.floor(targetWidth * 0.7);
                        targetHeight = Math.floor(targetHeight * 0.7);
                        quality = Math.max(0.4, quality * 0.8);
                    } else if (sizeKB > 200) {
                        // Large, moderate reduction
                        targetWidth = Math.floor(targetWidth * 0.8);
                        targetHeight = Math.floor(targetHeight * 0.8);
                        quality = Math.max(0.35, quality * 0.85);
                    } else if (sizeKB > 150) {
                        // Getting closer, smaller adjustments
                        targetWidth = Math.floor(targetWidth * 0.9);
                        targetHeight = Math.floor(targetHeight * 0.9);
                        quality = Math.max(0.3, quality * 0.9);
                    } else {
                        // Very close, fine-tune quality only
                        quality = Math.max(0.25, quality * ratio * 0.95);
                    }
                    
                    // Prevent dimensions from getting too small
                    if (targetWidth < 300) targetWidth = 300;
                    if (targetHeight < 225) targetHeight = 225;
                }
                
                // Final fallback - guaranteed under 100KB
                const finalBlob = await tryCompression(300, 225, 0.25);
                console.log(`FALLBACK: Final size ${(finalBlob.size/1024).toFixed(1)}KB`);
                resolve(finalBlob);
            };
            
            compressIteratively();
        };
        
        img.onerror = () => {
            console.error('Error loading image for compression');
            resolve(file); // Return original if compression fails
        };
        
        img.src = URL.createObjectURL(file);
    });
}

// Upload Activity Photo (updated)
window.uploadActivityPhoto = function(activity) {
    showPhotoOptions(activity);
}

// Handle Activity Photo Upload with Compression
window.handleActivityPhotoUpload = async function(activity, input) {
    if (!appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    const files = Array.from(input.files);
    
    showSpinner(true);
    showToast('Compressing and processing photos...', 'info');
    
    for (const file of files) {
        try {
            console.log(`Original: ${file.name} - ${(file.size / 1024 / 1024).toFixed(2)}MB`);
            
            // Compress to target 100KB
            const compressedBlob = await compressImageTo100KB(file);
            const finalSizeKB = (compressedBlob.size / 1024).toFixed(1);
            
            // Convert compressed blob to base64
            const reader = new FileReader();
            reader.onload = async function(event) {
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
                appState.junctionData[junctionId].lastUpdated = new Date().toISOString();
                await saveToFirestore(junctionId);
                
                showSpinner(false);
                showToast(`Photo compressed from ${(file.size/1024/1024).toFixed(1)}MB to ${finalSizeKB}KB`, 'success');
            };
            
            reader.readAsDataURL(compressedBlob);
            
        } catch (error) {
            console.error('Error processing photo:', error);
            showSpinner(false);
            showToast('Error compressing photo. Please try a different image.', 'error');
        }
    }
    
    // Clear the input
    input.value = '';
}

// Helper function to get status label
function getStatusLabel(status) {
    switch(status) {
        case 'pending': return '⏳ Pending';
        case 'in_progress': return '🔄 In Progress';
        case 'completed': return '✅ Completed';
        case 'rectified': return '✅ Rectified';
        default: return '⏳ Pending';
    }
}

































// Render Activity Photos
function renderActivityPhotos(activity) {
    const junctionId = appState.selectedJunction.Location_Id;
    const photos = appState.junctionData[junctionId]?.activities[activity]?.photos || [];
    const container = document.getElementById(`photos-${activity.replace(/\s+/g, '-')}`);
    
    if (container) {
        const activityEscaped = activity.replace(/'/g, "\\'");
        container.innerHTML = photos.map((photo, index) => `
            <div class="activity-photo-item" onclick="openPhotoPreview('${activityEscaped}', ${index}, '${photo}')">
                <img src="${photo}" alt="Photo">
                <div class="photo-overlay">
                    <span class="photo-view-icon">👁</span>
                </div>
            </div>
        `).join('');
        
        // Fix desktop photo preview after rendering
        setTimeout(fixDesktopPhotoPreview, 100);
    }
}

// Remove Activity Photo
window.removeActivityPhoto = async function(activity, index) {
    if (!appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    appState.junctionData[junctionId].activities[activity].photos.splice(index, 1);
    
    renderActivityPhotos(activity);
    appState.junctionData[junctionId].lastUpdated = new Date().toISOString();
    await saveToFirestore(junctionId);
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
    
    const overallProgress = (totalActivitiesCompleted / totalActivities) * 100;
    const progressBar = document.getElementById('overallProgress');
    if (progressBar) {
        progressBar.style.width = `${overallProgress}%`;
        progressBar.textContent = `${overallProgress.toFixed(1)}%`;
    }
    
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
        document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelector('[data-tab="junction"]').classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById('junction-tab').classList.add('active');
        
        selectJunction(junction);
    }
}

// Tab Navigation
function initializeEventListeners() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            const tabContent = document.getElementById(`${tabName}-tab`);
            if (tabContent) tabContent.classList.add('active');
            
            if (tabName === 'summary') {
                updateSummaryTab();
            }
            
            if (tabName === 'activities') {
                updateCurrentJunctionBanner();
            }
        });
    });
    
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
window.saveDraft = async function() {
    await saveToFirestore();
    showToast('Draft saved to cloud!', 'success');
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
    
    try {
        await saveToFirestore(junctionId);
        
        await db.collection('submissions').add({
            junctionId: junctionId,
            junctionName: appState.selectedJunction.Name,
            submittedAt: appState.junctionData[junctionId].submittedAt,
            data: inspectionData,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showSpinner(false);
        updateSummaryTab();
        renderJunctionList(junctionData);
        showToast(`Inspection report for Junction ${junctionId} submitted successfully!`, 'success');
    } catch (error) {
        console.error('Error submitting inspection:', error);
        showSpinner(false);
        showToast('Error submitting report. Please try again.', 'error');
    }
}

// Generate Daily Report
window.generateDailyReport = async function() {
    const fromDate = document.getElementById('reportFromDate')?.value || getTodayDate();
    const toDate = document.getElementById('reportToDate')?.value || getTodayDate();
    
    await loadFromFirestore();
    showSpinner(true);
    
    try {
        // Check if docx library is available
        if (typeof docx === 'undefined') {
            throw new Error('DocX library not loaded');
        }
        
        const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun } = docx;
        
        let hasData = false;
        let totalActivitiesStarted = 0;
        let totalActivitiesCompleted = 0;
        
        const sections = [];
        
        // Title and header
        sections.push(
            new Paragraph({
                text: "CHENNAI ITS - INSPECTION REPORT",
                heading: HeadingLevel.TITLE,
                alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
                text: "=====================================",
                alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
                text: `Date Range: ${formatDate(fromDate)} to ${formatDate(toDate)}`,
                alignment: AlignmentType.CENTER,
            }),
            new Paragraph({ text: "" })
        );
        
        for (const junction of junctionData) {
            const junctionId = junction.Location_Id;
            const data = appState.junctionData[junctionId];
            
            if (data && data.activities) {
                let junctionHasData = false;
                const junctionSections = [];
                
                junctionSections.push(
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: `JUNCTION: ${junction.Name}`,
                                bold: true,
                                size: 28,
                            })
                        ],
                    }),
                    new Paragraph({
                        text: `ID: ${junctionId} | Corridor: ${junction.Corridors_Name}`,
                    }),
                    new Paragraph({
                        text: "-----------------------------------------",
                    })
                );
                
                for (const activity of activities) {
                    const actData = data.activities[activity];
                    if (actData && actData.dates) {
                        let activityInRange = false;
                        let activityText = '';
                        
                        if (actData.dates.progressDate && isDateInRange(actData.dates.progressDate, fromDate, toDate)) {
                            activityInRange = true;
                            totalActivitiesStarted++;
                            activityText += `Started: ${activity} on ${formatDate(actData.dates.progressDate)}`;
                        }
                        
                        if (actData.dates.completedDate && isDateInRange(actData.dates.completedDate, fromDate, toDate)) {
                            activityInRange = true;
                            totalActivitiesCompleted++;
                            if (activityText) {
                                activityText = `Completed: ${activity} (Started: ${formatDate(actData.dates.progressDate)}, Completed: ${formatDate(actData.dates.completedDate)})`;
                            } else {
                                activityText = `Completed: ${activity} on ${formatDate(actData.dates.completedDate)}`;
                            }
                        }
                        
                        if (activityInRange) {
                            junctionHasData = true;
                            
                            junctionSections.push(
                                new Paragraph({
                                    children: [
                                        new TextRun({
                                            text: activityText,
                                            bold: true,
                                        })
                                    ],
                                })
                            );
                            
                            if (actData.observation) {
                                junctionSections.push(
                                    new Paragraph({
                                        text: `   Notes: ${actData.observation}`,
                                        indent: { left: 720 },
                                    })
                                );
                            }
                            
                            if (actData.photos && actData.photos.length > 0) {
                                junctionSections.push(
                                    new Paragraph({
                                        text: `   Photos: ${actData.photos.length} attached`,
                                        indent: { left: 720 },
                                    })
                                );
                                
                                // Add photos
                                for (let i = 0; i < Math.min(actData.photos.length, 3); i++) {
                                    try {
                                        const photoData = actData.photos[i];
                                        if (photoData.startsWith('data:image/')) {
                                            const base64Data = photoData.split(',')[1];
                                            const binaryData = atob(base64Data);
                                            const bytes = new Uint8Array(binaryData.length);
                                            for (let j = 0; j < binaryData.length; j++) {
                                                bytes[j] = binaryData.charCodeAt(j);
                                            }
                                            
                                            junctionSections.push(
                                                new Paragraph({
                                                    children: [
                                                        new ImageRun({
                                                            data: bytes,
                                                            transformation: {
                                                                width: 300,
                                                                height: 200,
                                                            },
                                                        })
                                                    ],
                                                    indent: { left: 720 },
                                                })
                                            );
                                        }
                                    } catch (photoError) {
                                        console.warn('Error adding photo:', photoError);
                                        junctionSections.push(
                                            new Paragraph({
                                                text: `   [Photo ${i + 1} - Could not be embedded]`,
                                                indent: { left: 720 },
                                            })
                                        );
                                    }
                                }
                            }
                            
                            junctionSections.push(new Paragraph({ text: "" }));
                        }
                    }
                }
                
                if (junctionHasData) {
                    hasData = true;
                    sections.push(...junctionSections);
                }
            }
        }
        
        if (!hasData) {
            showSpinner(false);
            showToast('No inspection data available for selected date range', 'error');
            return;
        }
        
        sections.push(
            new Paragraph({
                text: "=====================================",
                alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "SUMMARY",
                        bold: true,
                        size: 28,
                    })
                ],
                alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
                text: `Activities Started: ${totalActivitiesStarted}`,
            }),
            new Paragraph({
                text: `Activities Completed: ${totalActivitiesCompleted}`,
            })
        );
        
        const doc = new Document({
            sections: [{
                properties: {},
                children: sections,
            }],
        });
        
        const blob = await Packer.toBlob(doc);
        const filename = `CITS_Report_${fromDate}_to_${toDate}.docx`;
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showSpinner(false);
        showToast('Word report with photos generated successfully!', 'success');
        
    } catch (error) {
        console.error('Error generating Word report:', error);
        showSpinner(false);
        
        // Fallback to text report
        showToast('Word generation failed, creating text report instead', 'warning');
        generateTextReport(fromDate, toDate);
    }
}

// Generate Weekly Report
window.generateWeeklyReport = async function() {
    const fromDate = document.getElementById('reportFromDate')?.value;
    const toDate = document.getElementById('reportToDate')?.value;
    
    await loadFromFirestore();
    showSpinner(true);
    
    try {
        if (typeof docx === 'undefined') {
            throw new Error('DocX library not loaded');
        }
        
        const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun } = docx;
        
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
        
        let weeklyJunctions = 0;
        let weeklyActivitiesStarted = 0;
        let weeklyActivitiesCompleted = 0;
        const junctionProgress = [];
        
        const sections = [];
        
        sections.push(
            new Paragraph({
                text: "CHENNAI ITS - WEEKLY SUMMARY REPORT",
                heading: HeadingLevel.TITLE,
                alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
                text: "====================================",
                alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
                text: `Week: ${formatDate(formatDateForInput(weekStart))} - ${formatDate(formatDateForInput(weekEnd))}`,
                alignment: AlignmentType.CENTER,
            }),
            new Paragraph({ text: "" })
        );
        
        for (const junction of junctionData) {
            const junctionId = junction.Location_Id;
            const data = appState.junctionData[junctionId];
            
            if (data && data.activities) {
                let junctionStarted = 0;
                let junctionCompleted = 0;
                const junctionPhotoActivities = [];
                
                for (const [activityName, activity] of Object.entries(data.activities)) {
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
                        
                        if (activity.photos && activity.photos.length > 0 && 
                            ((activity.dates.progressDate && isDateInRange(activity.dates.progressDate, formatDateForInput(weekStart), formatDateForInput(weekEnd))) ||
                             (activity.dates.completedDate && isDateInRange(activity.dates.completedDate, formatDateForInput(weekStart), formatDateForInput(weekEnd))))) {
                            junctionPhotoActivities.push({
                                name: activityName,
                                photos: activity.photos.slice(0, 2), // Limit to 2 photos per activity
                                observation: activity.observation
                            });
                        }
                    }
                }
                
                if (junctionStarted > 0 || junctionCompleted > 0) {
                    weeklyJunctions++;
                    junctionProgress.push({
                        junction: junction,
                        started: junctionStarted,
                        completed: junctionCompleted,
                        progress: (junctionCompleted / activities.length * 100).toFixed(1),
                        photoActivities: junctionPhotoActivities
                    });
                }
            }
        }
        
        sections.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: "SUMMARY",
                        bold: true,
                        size: 28,
                    })
                ],
            }),
            new Paragraph({
                text: `Total Junctions with Activity: ${weeklyJunctions}`,
            }),
            new Paragraph({
                text: `Activities Started: ${weeklyActivitiesStarted}`,
            }),
            new Paragraph({
                text: `Activities Completed: ${weeklyActivitiesCompleted}`,
            }),
            new Paragraph({ text: "" })
        );
        
        if (junctionProgress.length > 0) {
            sections.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "JUNCTION-WISE DETAILS",
                            bold: true,
                            size: 24,
                        })
                    ],
                })
            );
            
            junctionProgress.sort((a, b) => b.completed - a.completed);
            
            for (const jp of junctionProgress.slice(0, 10)) { // Limit to top 10 junctions
                sections.push(
                    new Paragraph({ text: "" }),
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: jp.junction.Name,
                                bold: true,
                                size: 22,
                            })
                        ],
                    }),
                    new Paragraph({
                        text: `ID: ${jp.junction.Location_Id} | Progress: ${jp.progress}% | Started: ${jp.started} | Completed: ${jp.completed}`,
                    })
                );
                
                if (jp.photoActivities && jp.photoActivities.length > 0) {
                    for (const photoActivity of jp.photoActivities.slice(0, 2)) { // Limit activities
                        sections.push(
                            new Paragraph({
                                text: `• ${photoActivity.name}`,
                                indent: { left: 720 },
                            })
                        );
                        
                        if (photoActivity.observation) {
                            sections.push(
                                new Paragraph({
                                    text: `  Notes: ${photoActivity.observation}`,
                                    indent: { left: 1440 },
                                })
                            );
                        }
                        
                        // Add first photo only
                        if (photoActivity.photos.length > 0) {
                            try {
                                const photoData = photoActivity.photos[0];
                                if (photoData.startsWith('data:image/')) {
                                    const base64Data = photoData.split(',')[1];
                                    const binaryData = atob(base64Data);
                                    const bytes = new Uint8Array(binaryData.length);
                                    for (let j = 0; j < binaryData.length; j++) {
                                        bytes[j] = binaryData.charCodeAt(j);
                                    }
                                    
                                    sections.push(
                                        new Paragraph({
                                            children: [
                                                new ImageRun({
                                                    data: bytes,
                                                    transformation: {
                                                        width: 250,
                                                        height: 180,
                                                    },
                                                })
                                            ],
                                            indent: { left: 1440 },
                                        })
                                    );
                                }
                            } catch (photoError) {
                                console.warn('Error adding photo to weekly report:', photoError);
                            }
                        }
                    }
                }
            }
        }
        
        const doc = new Document({
            sections: [{
                properties: {},
                children: sections,
            }],
        });
        
        const blob = await Packer.toBlob(doc);
        const filename = `CITS_Weekly_Report_${formatDateForInput(weekStart)}.docx`;
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showSpinner(false);
        showToast('Weekly Word report generated successfully!', 'success');
        
    } catch (error) {
        console.error('Error generating weekly Word report:', error);
        showSpinner(false);
        showToast('Word generation failed, creating text report instead', 'warning');
        generateWeeklyTextReport(fromDate, toDate);
    }
}

// Fallback text report functions
function generateTextReport(fromDate, toDate) {
    // Your original daily report code here as backup
    console.log('Generating fallback text report');
}

function generateWeeklyTextReport(fromDate, toDate) {
    // Your original weekly report code here as backup
    console.log('Generating fallback weekly text report');
}

// Export All Data with Dates
window.exportAllData = async function() {
    await loadFromFirestore();
    
    let csvContent = 'Junction ID,Junction Name,Corridor,Activity,Status,Progress Date,Completed Date,Observation,Photos Count,RFP Qty,Proposed Qty,GFC Qty,RFI Qty,Site Qty,Quantity Comparison,Last Updated\n';
    
    junctionData.forEach(junction => {
        const junctionId = junction.Location_Id;
        const data = appState.junctionData[junctionId];
        
        if (data && data.activities) {
            activities.forEach(activity => {
                const actData = data.activities[activity] || { 
                    status: 'pending', 
                    observation: '', 
                    photos: [], 
                    dates: {},
                    quantities: {}
                };
                
                if (activity === 'Poles Installation') {
                    // Create separate rows for Standard and Cantilever poles
                    if (actData.quantities?.standard) {
                        const standardData = actData.quantities.standard;
                        csvContent += `${junctionId},`;
                        csvContent += `"${junction.Name}",`;
                        csvContent += `"${junction.Corridors_Name}",`;
                        csvContent += `"${activity} - Standard Pole",`;
                        csvContent += `${actData.status || 'pending'},`;
                        csvContent += `${actData.dates?.progressDate || ''},`;
                        csvContent += `${actData.dates?.completedDate || ''},`;
                        csvContent += `"${actData.observation || ''}",`;
                        csvContent += `${actData.photos ? actData.photos.length : 0},`;
                        csvContent += `${standardData.rfp || ''},`;
                        csvContent += `${standardData.boq || ''},`;
                        csvContent += `${standardData.gfc || ''},`;
                        csvContent += `${standardData.rfi || ''},`;
                        csvContent += `${standardData.site || ''},`;
                        csvContent += `"${generateQuantityComparisonText(standardData, 'Standard Pole')}",`;
                        csvContent += `${data.lastUpdated || ''}\n`;
                    }
                    
                    if (actData.quantities?.cantilever) {
                        const cantileverData = actData.quantities.cantilever;
                        csvContent += `${junctionId},`;
                        csvContent += `"${junction.Name}",`;
                        csvContent += `"${junction.Corridors_Name}",`;
                        csvContent += `"${activity} - Cantilever Pole",`;
                        csvContent += `${actData.status || 'pending'},`;
                        csvContent += `${actData.dates?.progressDate || ''},`;
                        csvContent += `${actData.dates?.completedDate || ''},`;
                        csvContent += `"${actData.observation || ''}",`;
                        csvContent += `${actData.photos ? actData.photos.length : 0},`;
                        csvContent += `${cantileverData.rfp || ''},`;
                        csvContent += `${cantileverData.boq || ''},`;
                        csvContent += `${cantileverData.gfc || ''},`;
                        csvContent += `${cantileverData.rfi || ''},`;
                        csvContent += `${cantileverData.site || ''},`;
                        csvContent += `"${generateQuantityComparisonText(cantileverData, 'Cantilever Pole')}",`;
                        csvContent += `${data.lastUpdated || ''}\n`;
                    }
                    
                    // If no quantities exist, create a default row
                    if (!actData.quantities?.standard && !actData.quantities?.cantilever) {
                        csvContent += `${junctionId},`;
                        csvContent += `"${junction.Name}",`;
                        csvContent += `"${junction.Corridors_Name}",`;
                        csvContent += `"${activity} - Standard Pole",`;
                        csvContent += `${actData.status || 'pending'},`;
                        csvContent += `${actData.dates?.progressDate || ''},`;
                        csvContent += `${actData.dates?.completedDate || ''},`;
                        csvContent += `"${actData.observation || ''}",`;
                        csvContent += `${actData.photos ? actData.photos.length : 0},`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `"",`;
                        csvContent += `${data.lastUpdated || ''}\n`;
                        
                        csvContent += `${junctionId},`;
                        csvContent += `"${junction.Name}",`;
                        csvContent += `"${junction.Corridors_Name}",`;
                        csvContent += `"${activity} - Cantilever Pole",`;
                        csvContent += `${actData.status || 'pending'},`;
                        csvContent += `${actData.dates?.progressDate || ''},`;
                        csvContent += `${actData.dates?.completedDate || ''},`;
                        csvContent += `"${actData.observation || ''}",`;
                        csvContent += `${actData.photos ? actData.photos.length : 0},`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `"",`;
                        csvContent += `${data.lastUpdated || ''}\n`;
                    }
                } else if (activity === 'Aspects Installation') {
                    // Create separate rows for each aspect type
                    const aspects = [
                        { key: 'redBall', label: 'Red Ball Aspects' },
                        { key: 'redArrow', label: 'Red Arrow Aspects' },
                        { key: 'amberBall', label: 'Amber Ball Aspects' },
                        { key: 'amberArrow', label: 'Amber Arrow Aspects' },
                        { key: 'greenBall', label: 'Green Ball Aspects' },
                        { key: 'greenLeft', label: 'Green Left Aspects' },
                        { key: 'greenUTurn', label: 'Green U-Turn Aspects' },
                        { key: 'greenRight', label: 'Green Right Aspects' },
                        { key: 'pedestrianRed', label: 'Pedestrian Red' },
                        { key: 'pedestrianGreen', label: 'Pedestrian Green' },
                        { key: 'pushButton', label: 'Push Button' },
                        { key: 'buzzer', label: 'Buzzer' }
                    ];
                    
                    aspects.forEach(aspect => {
                        const aspectData = actData.quantities?.[aspect.key];
                        csvContent += `${junctionId},`;
                        csvContent += `"${junction.Name}",`;
                        csvContent += `"${junction.Corridors_Name}",`;
                        csvContent += `"${activity} - ${aspect.label}",`;
                        csvContent += `${actData.status || 'pending'},`;
                        csvContent += `${actData.dates?.progressDate || ''},`;
                        csvContent += `${actData.dates?.completedDate || ''},`;
                        csvContent += `"${actData.observation || ''}",`;
                        csvContent += `${actData.photos ? actData.photos.length : 0},`;
                        csvContent += `${aspectData?.rfp || ''},`;
                        csvContent += `${aspectData?.boq || ''},`;
                        csvContent += `${aspectData?.gfc || ''},`;
                        csvContent += `${aspectData?.rfi || ''},`;
                        csvContent += `${aspectData?.site || ''},`;
                        csvContent += `"${generateQuantityComparisonText(aspectData, aspect.label)}",`;
                        csvContent += `${data.lastUpdated || ''}\n`;
                    });
                } else {
                    // Handle regular activities
                    const rfpQty = actData.quantities?.rfp || '';
                    const proposedQty = actData.quantities?.boq || '';
                    const gfcQty = actData.quantities?.gfc || '';
                    const rfiQty = actData.quantities?.rfi || '';
                    const siteQty = actData.quantities?.site || '';
                    const quantityComparison = generateQuantityComparisonText(actData.quantities, activity);
                
                csvContent += `${junctionId},`;
                csvContent += `"${junction.Name}",`;
                csvContent += `"${junction.Corridors_Name}",`;
                csvContent += `"${activity}",`;
                csvContent += `${actData.status || 'pending'},`;
                csvContent += `${actData.dates?.progressDate || ''},`;
                csvContent += `${actData.dates?.completedDate || ''},`;
                csvContent += `"${actData.observation || ''}",`;
                csvContent += `${actData.photos ? actData.photos.length : 0},`;
                    csvContent += `${rfpQty},`;
                    csvContent += `${proposedQty},`;
                    csvContent += `${gfcQty},`;
                    csvContent += `${rfiQty},`;
                    csvContent += `${siteQty},`;
                    csvContent += `"${quantityComparison}",`;
                csvContent += `${data.lastUpdated || ''}\n`;
                }
            });
        } else {
            activities.forEach(activity => {
                if (activity === 'Poles Installation') {
                    // Create default rows for Standard and Cantilever poles
                    csvContent += `${junctionId},`;
                    csvContent += `"${junction.Name}",`;
                    csvContent += `"${junction.Corridors_Name}",`;
                    csvContent += `"${activity} - Standard Pole",`;
                    csvContent += `pending,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `"",`;
                    csvContent += `0,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `"",`;
                    csvContent += `\n`;
                    
                    csvContent += `${junctionId},`;
                    csvContent += `"${junction.Name}",`;
                    csvContent += `"${junction.Corridors_Name}",`;
                    csvContent += `"${activity} - Cantilever Pole",`;
                    csvContent += `pending,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `"",`;
                    csvContent += `0,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `"",`;
                    csvContent += `\n`;
                } else if (activity === 'Aspects Installation') {
                    // Create default rows for each aspect type
                    const aspects = [
                        { key: 'redBall', label: 'Red Ball Aspects' },
                        { key: 'redArrow', label: 'Red Arrow Aspects' },
                        { key: 'amberBall', label: 'Amber Ball Aspects' },
                        { key: 'amberArrow', label: 'Amber Arrow Aspects' },
                        { key: 'greenBall', label: 'Green Ball Aspects' },
                        { key: 'greenLeft', label: 'Green Left Aspects' },
                        { key: 'greenUTurn', label: 'Green U-Turn Aspects' },
                        { key: 'greenRight', label: 'Green Right Aspects' },
                        { key: 'pedestrianRed', label: 'Pedestrian Red' },
                        { key: 'pedestrianGreen', label: 'Pedestrian Green' },
                        { key: 'pushButton', label: 'Push Button' },
                        { key: 'buzzer', label: 'Buzzer' }
                    ];
                    
                    aspects.forEach(aspect => {
                        csvContent += `${junctionId},`;
                        csvContent += `"${junction.Name}",`;
                        csvContent += `"${junction.Corridors_Name}",`;
                        csvContent += `"${activity} - ${aspect.label}",`;
                        csvContent += `pending,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `"",`;
                        csvContent += `0,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `,`;
                        csvContent += `"",`;
                        csvContent += `\n`;
                    });
                } else {
                    // Handle regular activities
                csvContent += `${junctionId},`;
                csvContent += `"${junction.Name}",`;
                csvContent += `"${junction.Corridors_Name}",`;
                csvContent += `"${activity}",`;
                csvContent += `pending,`;
                csvContent += `,`;
                csvContent += `,`;
                csvContent += `"",`;
                csvContent += `0,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `,`;
                    csvContent += `"",`;
                csvContent += `\n`;
                }
            });
        }
    });
    
    downloadReport(csvContent, `CITS_Complete_Data_${getTodayDate()}.csv`);
    showToast('Complete data exported successfully!', 'success');
}

// Generate Quantity Comparison Text for CSV Export
function generateQuantityComparisonText(quantities, activityName) {
    if (!quantities) return '';
    
    const { rfp = 0, boq = 0, gfc = 0, rfi = 0, site = 0 } = quantities;
    
    // Convert to numbers for calculations
    const rfpNum = parseFloat(rfp) || 0;
    const boqNum = parseFloat(boq) || 0;
    const gfcNum = parseFloat(gfc) || 0;
    const rfiNum = parseFloat(rfi) || 0;
    const siteNum = parseFloat(site) || 0;
    
    let comparisons = [];
    
    // RFI vs Site comparison (FIRST)
    if (rfiNum > 0 && siteNum > 0) {
        const rfiDiff = siteNum - rfiNum;
        const rfiStatus = rfiDiff === 0 ? 'Match' : rfiDiff > 0 ? 'Excess' : 'Shortage';
        comparisons.push(`${activityName} RFI vs Site: ${rfiStatus} ${Math.abs(rfiDiff)}`);
    }
    
    // Proposed vs Site comparison (SECOND)
    if (boqNum > 0 && siteNum > 0) {
        const boqDiff = siteNum - boqNum;
        const boqStatus = boqDiff === 0 ? 'Match' : boqDiff > 0 ? 'Excess' : 'Shortage';
        comparisons.push(`${activityName} Proposed vs Site: ${boqStatus} ${Math.abs(boqDiff)}`);
    }
    
    return comparisons.join('; ');
}

// Get Aspect Label for CSV Export
function getAspectLabel(aspectKey) {
    const aspectLabels = {
        'redBall': 'Red Ball Aspects',
        'redArrow': 'Red Arrow Aspects',
        'amberBall': 'Amber Ball Aspects',
        'amberArrow': 'Amber Arrow Aspects',
        'greenBall': 'Green Ball Aspects',
        'greenLeft': 'Green Left Aspects',
        'greenUTurn': 'Green U-Turn Aspects',
        'greenRight': 'Green Right Aspects',
        'pedestrianRed': 'Pedestrian Red',
        'pedestrianGreen': 'Pedestrian Green',
        'pushButton': 'Push Button',
        'buzzer': 'Buzzer'
    };
    
    return aspectLabels[aspectKey] || aspectKey;
}
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

// Clean up listeners when page unloads
window.addEventListener('beforeunload', () => {
    appState.unsubscribers.forEach(unsubscribe => unsubscribe());
});

// Clean up listeners when page unloads
window.addEventListener('beforeunload', () => {
    appState.unsubscribers.forEach(unsubscribe => unsubscribe());
});

// Global variable to track current activity
let currentPhotoActivity = null;

// Updated showPhotoOptions with modern modal approach
window.showPhotoOptions = function(activity) {
    // Check if it's a mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
        // For mobile devices, show a modern modal with buttons
        const modalHTML = `
            <div class="photo-options-modal" id="photo-options-modal" style="display: flex;">
                <div class="photo-options-content">
                    <div class="photo-options-title">Choose Photo Source</div>
                    <button class="photo-option-btn" onclick="selectActivityPhotoSource('camera', '${activity.replace(/'/g, "\\'")}')">
                        <span class="icon">📷</span>
                        <span>Take Photo</span>
                    </button>
                    <button class="photo-option-btn" onclick="selectActivityPhotoSource('gallery', '${activity.replace(/'/g, "\\'")}')">
                        <span class="icon">🖼️</span>
                        <span>Choose from Gallery</span>
                    </button>
                    <button class="photo-cancel-btn" onclick="closePhotoOptionsModal()">Cancel</button>
                </div>
            </div>
        `;
        
        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    } else {
        // For desktop/laptop, directly open file picker
        const galleryInput = document.getElementById(`photo-gallery-${activity.replace(/\s+/g, '-')}`);
        if (galleryInput) {
            galleryInput.click();
        }
    }
}

// Select Activity Photo Source
window.selectActivityPhotoSource = function(source, activity) {
    const cameraInput = document.getElementById(`photo-camera-${activity.replace(/\s+/g, '-')}`);
    const galleryInput = document.getElementById(`photo-gallery-${activity.replace(/\s+/g, '-')}`);
    
    if (source === 'camera' && cameraInput) {
        cameraInput.click();
    } else if (source === 'gallery' && galleryInput) {
        galleryInput.click();
    }
    
    // Close the modal
    closePhotoOptionsModal();
}

// Photo preview variables
let currentPreviewActivity = null;
let currentPreviewIndex = null;
let currentPreviewType = null;

// Open photo preview
window.openPhotoPreview = function(activity, photoIndex, photoSrc) {
    currentPreviewActivity = activity;
    currentPreviewIndex = photoIndex;
    
    const modal = document.getElementById('photoPreviewModal');
    const image = document.getElementById('photoPreviewImage');
    
    if (modal && image) {
        image.src = photoSrc;
        modal.style.display = 'block';
    }
}

// Close photo preview
window.closePhotoPreview = function() {
    const modal = document.getElementById('photoPreviewModal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Also close any open confirmation modal
    const confirmModal = document.getElementById('deleteConfirmationModal');
    if (confirmModal) {
        confirmModal.style.display = 'none';
    }

    currentPreviewActivity = null;
    currentPreviewIndex = null;
    currentPreviewType = null;
}

// Confirm photo delete - improved version
window.confirmPhotoDelete = function() {
    console.log('Confirming delete for:', currentPreviewActivity, currentPreviewIndex);
    
    // Close the photo preview modal
    const previewModal = document.getElementById('photoPreviewModal');
    if (previewModal) {
        previewModal.style.display = 'none';
    }
    
    // Small delay to ensure smooth transition
    setTimeout(() => {
        const confirmModal = document.getElementById('deleteConfirmationModal');
        if (confirmModal) {
            confirmModal.style.display = 'block';
            confirmModal.style.zIndex = '1002';
        }
    }, 100);
}

// Execute photo delete
window.executePhotoDelete = async function() {
    console.log('Executing delete for:', currentPreviewActivity, currentPreviewIndex, currentPreviewType); // Debug
    
    if (currentPreviewActivity !== null && currentPreviewIndex !== null) {
        try {
            const junctionId = appState.selectedJunction.Location_Id;
            
                // Delete from general activity photos
                await removeActivityPhoto(currentPreviewActivity, currentPreviewIndex);
                showToast('Photo deleted successfully', 'success');
            
            cancelPhotoDelete();
            
            // Reset preview variables
            currentPreviewActivity = null;
            currentPreviewIndex = null;
            currentPreviewType = null;
            
        } catch (error) {
            console.error('Error deleting photo:', error);
            showToast('Error deleting photo', 'error');
        }
    } else {
        console.error('No photo selected for deletion');
        cancelPhotoDelete();
    }
}

// Cancel photo delete - close confirmation and reset
window.cancelPhotoDelete = function() {
    const confirmModal = document.getElementById('deleteConfirmationModal');
    if (confirmModal) {
        confirmModal.style.display = 'none';
    }
    
    // Don't reopen preview, just reset
    currentPreviewActivity = null;
    currentPreviewIndex = null;
    currentPreviewType = null;
}

// Close modals when clicking outside
document.addEventListener('click', function(event) {
    const photoModal = document.getElementById('photoOptionsModal');
    const previewModal = document.getElementById('photoPreviewModal');
    const deleteModal = document.getElementById('deleteConfirmationModal');
    
    if (photoModal && event.target === photoModal) {
        hidePhotoOptions();
    }
    if (previewModal && event.target === previewModal) {
        closePhotoPreview();
    }
    if (deleteModal && event.target === deleteModal) {
        cancelPhotoDelete();
    }
});

// Hide photo options modal
window.hidePhotoOptions = function() {
    currentPhotoActivity = null;
    const modal = document.getElementById('photoOptionsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Select photo source
window.selectPhotoSource = function(source) {
    if (!currentPhotoActivity) return;
    
    const activity = currentPhotoActivity;
    let input;
    
    if (source === 'camera') {
        input = document.getElementById(`photo-camera-${activity.replace(/\s+/g, '-')}`);
    } else {
        input = document.getElementById(`photo-gallery-${activity.replace(/\s+/g, '-')}`);
    }
    
    if (input) {
        input.click();
    }
    
    hidePhotoOptions();
}

// Fix desktop photo preview by ensuring click events work
function fixDesktopPhotoPreview() {
    // Add click event listeners to all photo items
    document.querySelectorAll('.activity-photo-item').forEach(item => {
        if (!item.hasAttribute('data-click-fixed')) {
            item.setAttribute('data-click-fixed', 'true');
            item.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Extract the onclick attribute and execute it
                const onclickAttr = this.getAttribute('onclick');
                if (onclickAttr) {
                    // Execute the onclick function
                    eval(onclickAttr);
                }
            });
        }
    });
}

// Open photo preview with debugging
window.openPhotoPreview = function(activity, photoIndex, photoSrc) {
    console.log('Opening photo preview:', activity, photoIndex, photoSrc); // Debug line
    
    currentPreviewActivity = activity;
    currentPreviewIndex = photoIndex;
    
    const modal = document.getElementById('photoPreviewModal');
    const image = document.getElementById('photoPreviewImage');
    
    console.log('Modal found:', modal); // Debug line
    console.log('Image found:', image); // Debug line
    
    if (modal && image) {
        image.src = photoSrc;
        modal.style.display = 'block';
        modal.style.zIndex = '9999'; // Force high z-index
        console.log('Modal should be visible now'); // Debug line
    } else {
        console.error('Modal or image element not found');
    }
}

// Photo zoom variables
let currentZoom = 1;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let imageOffset = { x: 0, y: 0 };

// Open photo preview with zoom functionality
window.openPhotoPreview = function(activity, photoIndex, photoSrc, type = 'general') {
    console.log('openPhotoPreview called:', { activity, photoIndex, photoSrc, type });
    
    currentPreviewActivity = activity;
    currentPreviewIndex = photoIndex;
    currentPreviewType = type;
    
    const modal = document.getElementById('photoPreviewModal');
    const image = document.getElementById('photoPreviewImage');
    
    console.log('Modal found:', !!modal);
    console.log('Image found:', !!image);
    
    if (modal && image) {
        image.src = photoSrc;
        modal.style.display = 'block';
        
        // Reset zoom and position
        currentZoom = 1;
        imageOffset = { x: 0, y: 0 };
        updateImageTransform();
        
        // Add drag functionality
        setupImageDrag(image);
        
        console.log('Photo preview opened successfully');
    } else {
        console.error('Modal or image element not found');
    }
}

// Improved zoom photo function
window.zoomPhoto = function(direction) {
    const zoomStep = 0.25;
    const minZoom = 0.8;  // Changed from 0.5 to 0.8
    const maxZoom = 3;
    
    if (direction === 'in' && currentZoom < maxZoom) {
        currentZoom += zoomStep;
    } else if (direction === 'out' && currentZoom > minZoom) {
        currentZoom -= zoomStep;
    }
    
    // Reset position if zoomed out to minimum
    if (currentZoom <= 1) {
        imageOffset = { x: 0, y: 0 };
    }
    
    updateImageTransform();
}

// Reset zoom to fit container properly
window.resetZoom = function() {
    currentZoom = 1;
    imageOffset = { x: 0, y: 0 };
    updateImageTransform();
}

// Update image transform
function updateImageTransform() {
    const image = document.getElementById('photoPreviewImage');
    const zoomLevelEl = document.getElementById('zoomLevel');
    
    if (image) {
        image.style.transform = `scale(${currentZoom}) translate(${imageOffset.x}px, ${imageOffset.y}px)`;
    }
    
    if (zoomLevelEl) {
        zoomLevelEl.textContent = `${Math.round(currentZoom * 100)}%`;
    }
}

// Setup image drag functionality
function setupImageDrag(image) {
    // Remove existing listeners
    image.onmousedown = null;
    image.onmousemove = null;
    image.onmouseup = null;
    
    image.addEventListener('mousedown', function(e) {
        if (currentZoom > 1) {
            isDragging = true;
            dragStart = { x: e.clientX - imageOffset.x, y: e.clientY - imageOffset.y };
            image.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });
    
    document.addEventListener('mousemove', function(e) {
        if (isDragging && currentZoom > 1) {
            imageOffset = {
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            };
            updateImageTransform();
        }
    });
    
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            image.style.cursor = 'grab';
        }
    });
    
    // Touch support for mobile
    image.addEventListener('touchstart', function(e) {
        if (currentZoom > 1 && e.touches.length === 1) {
            isDragging = true;
            const touch = e.touches[0];
            dragStart = { x: touch.clientX - imageOffset.x, y: touch.clientY - imageOffset.y };
            e.preventDefault();
        }
    });
    
    image.addEventListener('touchmove', function(e) {
        if (isDragging && currentZoom > 1 && e.touches.length === 1) {
            const touch = e.touches[0];
            imageOffset = {
                x: touch.clientX - dragStart.x,
                y: touch.clientY - dragStart.y
            };
            updateImageTransform();
            e.preventDefault();
        }
    });
    
    image.addEventListener('touchend', function() {
        isDragging = false;
    });
    
    // Mouse wheel zoom
    image.addEventListener('wheel', function(e) {
        e.preventDefault();
        if (e.deltaY < 0) {
            zoomPhoto('in');
        } else {
            zoomPhoto('out');
        }
    });
}

// Generate Quantity Fields based on Activity Type
function generateQuantityFields(activity, activityData) {
    if (activity === 'Poles Installation') {
        return `
            <div class="activity-table-section">
                <div class="activity-table-header">
                    <div class="activity-table-cell activity-label-header">Pole Type</div>
                    <div class="activity-table-cell">📋 RFP</div>
                    <div class="activity-table-cell">📄 Proposed</div>
                    <div class="activity-table-cell">🏗️ GFC</div>
                    <div class="activity-table-cell">📝 RFI</div>
                    <div class="activity-table-cell">📍 Site</div>
                </div>
                <div class="activity-table-row">
                    <div class="activity-table-cell activity-label">
                        <span class="activity-icon">🏗️</span>
                        <span class="activity-name">Standard Pole</span>
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.standard?.rfp || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'standard', 'rfp', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.standard?.boq || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'standard', 'boq', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.standard?.gfc || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'standard', 'gfc', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.standard?.rfi || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'standard', 'rfi', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact site-input" 
                               placeholder="0"
                               value="${activityData.quantities?.standard?.site || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'standard', 'site', this.value)"
                               min="0">
                    </div>
                </div>
                <div class="activity-table-row">
                    <div class="activity-table-cell activity-label">
                        <span class="activity-icon">🏗️</span>
                        <span class="activity-name">Cantilever Pole</span>
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.cantilever?.rfp || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'cantilever', 'rfp', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.cantilever?.boq || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'cantilever', 'boq', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.cantilever?.gfc || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'cantilever', 'gfc', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.cantilever?.rfi || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'cantilever', 'rfi', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact site-input" 
                               placeholder="0"
                               value="${activityData.quantities?.cantilever?.site || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'cantilever', 'site', this.value)"
                               min="0">
                    </div>
                </div>
            </div>
        `;
    } else if (activity === 'Aspects Installation') {
        const aspects = [
            { key: 'redBall', label: 'Red Ball Aspects', icon: '🔴' },
            { key: 'redArrow', label: 'Red Arrow Aspects', icon: '🔴' },
            { key: 'amberBall', label: 'Amber Ball Aspects', icon: '🟡' },
            { key: 'amberArrow', label: 'Amber Arrow Aspects', icon: '🟡' },
            { key: 'greenBall', label: 'Green Ball Aspects', icon: '🟢' },
            { key: 'greenLeft', label: 'Green Left Aspects', icon: '🟢' },
            { key: 'greenUTurn', label: 'Green U-Turn Aspects', icon: '🟢' },
            { key: 'greenRight', label: 'Green Right Aspects', icon: '🟢' },
            { key: 'pedestrianRed', label: 'Pedestrian Red', icon: '🚶‍♂️' },
            { key: 'pedestrianGreen', label: 'Pedestrian Green', icon: '🚶‍♂️' },
            { key: 'pushButton', label: 'Push Button', icon: '🔘' },
            { key: 'buzzer', label: 'Buzzer', icon: '🔊' }
        ];
        
        return `
            <div class="aspect-table-section">
                <div class="aspect-table-header">
                    <div class="aspect-table-cell aspect-label-header">Aspect Type</div>
                    <div class="aspect-table-cell">📋 RFP</div>
                    <div class="aspect-table-cell">📄 Proposed</div>
                    <div class="aspect-table-cell">🏗️ GFC</div>
                    <div class="aspect-table-cell">📝 RFI</div>
                    <div class="aspect-table-cell">📍 Site</div>
                </div>
                ${aspects.map(aspect => `
                    <div class="aspect-table-row">
                        <div class="aspect-table-cell aspect-label">
                            <span class="aspect-icon">${aspect.icon}</span>
                            <span class="aspect-name">${aspect.label}</span>
                        </div>
                        <div class="aspect-table-cell">
                            <input type="number" 
                                   class="quantity-input compact" 
                                   placeholder="0"
                                   value="${activityData.quantities?.[aspect.key]?.rfp || ''}"
                                   onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', '${aspect.key}', 'rfp', this.value)"
                                   min="0">
                        </div>
                        <div class="aspect-table-cell">
                            <input type="number" 
                                   class="quantity-input compact" 
                                   placeholder="0"
                                   value="${activityData.quantities?.[aspect.key]?.boq || ''}"
                                   onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', '${aspect.key}', 'boq', this.value)"
                                   min="0">
                        </div>
                        <div class="aspect-table-cell">
                            <input type="number" 
                                   class="quantity-input compact" 
                                   placeholder="0"
                                   value="${activityData.quantities?.[aspect.key]?.gfc || ''}"
                                   onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', '${aspect.key}', 'gfc', this.value)"
                                   min="0">
                        </div>
                        <div class="aspect-table-cell">
                            <input type="number" 
                                   class="quantity-input compact" 
                                   placeholder="0"
                                   value="${activityData.quantities?.[aspect.key]?.rfi || ''}"
                                   onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', '${aspect.key}', 'rfi', this.value)"
                                   min="0">
                        </div>
                        <div class="aspect-table-cell">
                            <input type="number" 
                                   class="quantity-input compact site-input" 
                                   placeholder="0"
                                   value="${activityData.quantities?.[aspect.key]?.site || ''}"
                                   onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', '${aspect.key}', 'site', this.value)"
                                   min="0">
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        // Default table layout for other activities
        return `
            <div class="activity-table-section">
                <div class="activity-table-header">
                    <div class="activity-table-cell activity-label-header">Activity Type</div>
                    <div class="activity-table-cell">📋 RFP</div>
                    <div class="activity-table-cell">📄 Proposed</div>
                    <div class="activity-table-cell">🏗️ GFC</div>
                    <div class="activity-table-cell">📝 RFI</div>
                    <div class="activity-table-cell">📍 Site</div>
                </div>
                <div class="activity-table-row">
                    <div class="activity-table-cell activity-label">
                        <span class="activity-icon">📋</span>
                        <span class="activity-name">${activity}</span>
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.rfp || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'rfp', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.boq || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'boq', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.gfc || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'gfc', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact" 
                               placeholder="0"
                               value="${activityData.quantities?.rfi || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'rfi', this.value)"
                               min="0">
                    </div>
                    <div class="activity-table-cell">
                        <input type="number" 
                               class="quantity-input compact site-input" 
                               placeholder="0"
                               value="${activityData.quantities?.site || ''}"
                               onchange="updateActivityQuantity('${activity.replace(/'/g, "\\'")}', 'site', this.value)"
                               min="0">
                    </div>
                </div>
            </div>
        `;
    }
}
// Update Activity Quantity
window.updateActivityQuantity = async function(activity, category, quantityType, value) {
    if (!appState.selectedJunction) return;
    
    const junctionId = appState.selectedJunction.Location_Id;
    
    if (!appState.junctionData[junctionId].activities[activity].quantities) {
        appState.junctionData[junctionId].activities[activity].quantities = {};
    }
    
    // Handle different activity types
    if (activity === 'Poles Installation') {
        // For pole installation, category is 'standard' or 'cantilever'
        if (!appState.junctionData[junctionId].activities[activity].quantities[category]) {
            appState.junctionData[junctionId].activities[activity].quantities[category] = {};
        }
        appState.junctionData[junctionId].activities[activity].quantities[category][quantityType] = value;
    } else if (activity === 'Aspects Installation') {
        // For aspect installation, category is the aspect key (e.g., 'redBall', 'greenLeft')
        if (!appState.junctionData[junctionId].activities[activity].quantities[category]) {
            appState.junctionData[junctionId].activities[activity].quantities[category] = {};
        }
        appState.junctionData[junctionId].activities[activity].quantities[category][quantityType] = value;
    } else {
        // For other activities, use the old structure
        appState.junctionData[junctionId].activities[activity].quantities[quantityType] = value;
    }
    
    appState.junctionData[junctionId].lastUpdated = new Date().toISOString();
    
    // Update the quantity summary
    const summaryElement = document.getElementById(`quantity-summary-${activity.replace(/\s+/g, '-')}`);
    if (summaryElement) {
        summaryElement.innerHTML = generateQuantitySummary(appState.junctionData[junctionId].activities[activity].quantities, activity);
    }
    
    await saveToFirestore(junctionId);
}

// Generate Quantity Summary
function generateQuantitySummary(quantities, activity) {
    if (!quantities) return '<div class="no-quantities">No quantities entered yet</div>';
    
    if (activity === 'Poles Installation') {
        return generatePoleQuantitySummary(quantities);
    } else if (activity === 'Aspects Installation') {
        return generateAspectQuantitySummary(quantities);
    } else {
        return generateDefaultQuantitySummary(quantities);
    }
}

// Generate Pole Installation Summary
function generatePoleQuantitySummary(quantities) {
    let summaryHTML = '<div class="quantity-comparison">';
    
    // Standard Pole Summary
    if (quantities.standard) {
        const { rfp = 0, boq = 0, gfc = 0, rfi = 0, site = 0 } = quantities.standard;
        const rfpNum = parseFloat(rfp) || 0;
        const boqNum = parseFloat(boq) || 0;
        const gfcNum = parseFloat(gfc) || 0;
        const rfiNum = parseFloat(rfi) || 0;
        const siteNum = parseFloat(site) || 0;
        
        summaryHTML += '<div class="pole-category-summary">';
        summaryHTML += '<h6>🏗️ Standard Pole</h6>';
        
        // RFI vs Site comparison (FIRST)
        if (rfiNum > 0 && siteNum > 0) {
            const rfiDiff = siteNum - rfiNum;
            const rfiStatus = rfiDiff === 0 ? 'match' : rfiDiff > 0 ? 'excess' : 'shortage';
            const rfiIcon = rfiDiff === 0 ? '✅' : rfiDiff > 0 ? '⚠️' : '❌';
            summaryHTML += `
                <div class="comparison-item ${rfiStatus}">
                    <span class="comparison-label">RFI vs Site:</span>
                    <span class="comparison-value">${rfiIcon} ${Math.abs(rfiDiff)} ${rfiDiff > 0 ? 'excess' : 'shortage'}</span>
                </div>
            `;
        }
        
        // Proposed vs Site comparison (SECOND)
        if (boqNum > 0 && siteNum > 0) {
            const boqDiff = siteNum - boqNum;
            const boqStatus = boqDiff === 0 ? 'match' : boqDiff > 0 ? 'excess' : 'shortage';
            const boqIcon = boqDiff === 0 ? '✅' : boqDiff > 0 ? '⚠️' : '❌';
            summaryHTML += `
                <div class="comparison-item ${boqStatus}">
                    <span class="comparison-label">Proposed vs Site:</span>
                    <span class="comparison-value">${boqIcon} ${Math.abs(boqDiff)} ${boqDiff > 0 ? 'excess' : 'shortage'}</span>
                </div>
            `;
        }
        
        summaryHTML += '</div>';
    }
    
    // Cantilever Pole Summary
    if (quantities.cantilever) {
        const { rfp = 0, boq = 0, gfc = 0, rfi = 0, site = 0 } = quantities.cantilever;
        const rfpNum = parseFloat(rfp) || 0;
        const boqNum = parseFloat(boq) || 0;
        const gfcNum = parseFloat(gfc) || 0;
        const rfiNum = parseFloat(rfi) || 0;
        const siteNum = parseFloat(site) || 0;
        
        summaryHTML += '<div class="pole-category-summary">';
        summaryHTML += '<h6>🏗️ Cantilever Pole</h6>';
        
        // RFI vs Site comparison (FIRST)
        if (rfiNum > 0 && siteNum > 0) {
            const rfiDiff = siteNum - rfiNum;
            const rfiStatus = rfiDiff === 0 ? 'match' : rfiDiff > 0 ? 'excess' : 'shortage';
            const rfiIcon = rfiDiff === 0 ? '✅' : rfiDiff > 0 ? '⚠️' : '❌';
            summaryHTML += `
                <div class="comparison-item ${rfiStatus}">
                    <span class="comparison-label">RFI vs Site:</span>
                    <span class="comparison-value">${rfiIcon} ${Math.abs(rfiDiff)} ${rfiDiff > 0 ? 'excess' : 'shortage'}</span>
                </div>
            `;
        }
        
        // Proposed vs Site comparison (SECOND)
        if (boqNum > 0 && siteNum > 0) {
            const boqDiff = siteNum - boqNum;
            const boqStatus = boqDiff === 0 ? 'match' : boqDiff > 0 ? 'excess' : 'shortage';
            const boqIcon = boqDiff === 0 ? '✅' : boqDiff > 0 ? '⚠️' : '❌';
            summaryHTML += `
                <div class="comparison-item ${boqStatus}">
                    <span class="comparison-label">Proposed vs Site:</span>
                    <span class="comparison-value">${boqIcon} ${Math.abs(boqDiff)} ${boqDiff > 0 ? 'excess' : 'shortage'}</span>
                </div>
            `;
        }
        
        summaryHTML += '</div>';
    }
    
    summaryHTML += '</div>';
    return summaryHTML;
}

// Generate Aspect Installation Summary
function generateAspectQuantitySummary(quantities) {
    let summaryHTML = '<div class="quantity-comparison">';
    
    const aspects = [
        { key: 'redBall', label: 'Red Ball', icon: '🔴' },
        { key: 'redArrow', label: 'Red Arrow', icon: '🔴' },
        { key: 'amberBall', label: 'Amber Ball', icon: '🟡' },
        { key: 'amberArrow', label: 'Amber Arrow', icon: '🟡' },
        { key: 'greenBall', label: 'Green Ball', icon: '🟢' },
        { key: 'greenLeft', label: 'Green Left', icon: '🟢' },
        { key: 'greenUTurn', label: 'Green U-Turn', icon: '🟢' },
        { key: 'greenRight', label: 'Green Right', icon: '🟢' },
        { key: 'pedestrianRed', label: 'Pedestrian Red', icon: '🚶‍♂️' },
        { key: 'pedestrianGreen', label: 'Pedestrian Green', icon: '🚶‍♂️' },
        { key: 'pushButton', label: 'Push Button', icon: '🔘' },
        { key: 'buzzer', label: 'Buzzer', icon: '🔊' }
    ];
    
    aspects.forEach(aspect => {
        if (quantities[aspect.key]) {
            const { rfp = 0, boq = 0, gfc = 0, rfi = 0, site = 0 } = quantities[aspect.key];
            const rfpNum = parseFloat(rfp) || 0;
            const boqNum = parseFloat(boq) || 0;
            const gfcNum = parseFloat(gfc) || 0;
            const rfiNum = parseFloat(rfi) || 0;
            const siteNum = parseFloat(site) || 0;
            
            // Only show if there are quantities to compare
            if ((rfiNum > 0 && siteNum > 0) || (boqNum > 0 && siteNum > 0)) {
                summaryHTML += `<div class="aspect-summary-group">`;
                summaryHTML += `<h6>${aspect.icon} ${aspect.label}</h6>`;
                
                // RFI vs Site comparison (FIRST)
                if (rfiNum > 0 && siteNum > 0) {
                    const rfiDiff = siteNum - rfiNum;
                    const rfiStatus = rfiDiff === 0 ? 'match' : rfiDiff > 0 ? 'excess' : 'shortage';
                    const rfiIcon = rfiDiff === 0 ? '✅' : rfiDiff > 0 ? '⚠️' : '❌';
                    summaryHTML += `
                        <div class="comparison-item ${rfiStatus}">
                            <span class="comparison-label">RFI vs Site:</span>
                            <span class="comparison-value">${rfiIcon} ${Math.abs(rfiDiff)} ${rfiDiff > 0 ? 'excess' : 'shortage'}</span>
                        </div>
                    `;
                }
                
                // Proposed vs Site comparison (SECOND)
                if (boqNum > 0 && siteNum > 0) {
                    const boqDiff = siteNum - boqNum;
                    const boqStatus = boqDiff === 0 ? 'match' : boqDiff > 0 ? 'excess' : 'shortage';
                    const boqIcon = boqDiff === 0 ? '✅' : boqDiff > 0 ? '⚠️' : '❌';
                    summaryHTML += `
                        <div class="comparison-item ${boqStatus}">
                            <span class="comparison-label">Proposed vs Site:</span>
                            <span class="comparison-value">${boqIcon} ${Math.abs(boqDiff)} ${boqDiff > 0 ? 'excess' : 'shortage'}</span>
                        </div>
                    `;
                }
                
                summaryHTML += `</div>`;
            }
        }
    });
    
    summaryHTML += '</div>';
    return summaryHTML;
}

// Generate Default Quantity Summary (for other activities)
function generateDefaultQuantitySummary(quantities) {
    if (!quantities) return '<div class="no-quantities">No quantities entered yet</div>';
    
    const { rfp = 0, boq = 0, gfc = 0, rfi = 0, site = 0 } = quantities;
    
    // Convert to numbers for calculations
    const rfpNum = parseFloat(rfp) || 0;
    const boqNum = parseFloat(boq) || 0;
    const gfcNum = parseFloat(gfc) || 0;
    const rfiNum = parseFloat(rfi) || 0;
    const siteNum = parseFloat(site) || 0;
    
    let summaryHTML = '<div class="quantity-comparison">';
    
    // RFI vs Site comparison (FIRST)
    if (rfiNum > 0 && siteNum > 0) {
        const rfiDiff = siteNum - rfiNum;
        const rfiStatus = rfiDiff === 0 ? 'match' : rfiDiff > 0 ? 'excess' : 'shortage';
        const rfiIcon = rfiDiff === 0 ? '✅' : rfiDiff > 0 ? '⚠️' : '❌';
        summaryHTML += `
            <div class="comparison-item ${rfiStatus}">
                <span class="comparison-label">RFI vs Site:</span>
                <span class="comparison-value">${rfiIcon} ${Math.abs(rfiDiff)} ${rfiDiff > 0 ? 'excess' : 'shortage'}</span>
            </div>
        `;
    }
    
    // Proposed vs Site comparison (SECOND)
    if (boqNum > 0 && siteNum > 0) {
        const boqDiff = siteNum - boqNum;
        const boqStatus = boqDiff === 0 ? 'match' : boqDiff > 0 ? 'excess' : 'shortage';
        const boqIcon = boqDiff === 0 ? '✅' : boqDiff > 0 ? '⚠️' : '❌';
        summaryHTML += `
            <div class="comparison-item ${boqStatus}">
                <span class="comparison-label">Proposed vs Site:</span>
                <span class="comparison-value">${boqIcon} ${Math.abs(boqDiff)} ${boqDiff > 0 ? 'excess' : 'shortage'}</span>
            </div>
        `;
    }
    
    summaryHTML += '</div>';
    
    return summaryHTML;
}

// END OF app.js - Complete file
