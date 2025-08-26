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
    
    activitySection.innerHTML = activities.map((activity, index) => {
        const activityData = junctionActivities[activity] || { status: 'pending', observation: '', photos: [], dates: {} };
        
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
    			<button class="photo-upload-btn" onclick="showPhotoOptions('${activityEscaped}')">
        			<span>📷</span> Add Photo
    			</button>
    			<input type="file" id="photo-camera-${activity.replace(/\s+/g, '-')}" 
           			accept="image/*" capture="environment" 
           			style="display: none;" 
           			onchange="handleActivityPhotoUpload('${activityEscaped}', this)">
    <input type="file" id="photo-gallery-${activity.replace(/\s+/g, '-')}" 
           accept="image/*" multiple 
           style="display: none;" 
           onchange="handleActivityPhotoUpload('${activityEscaped}', this)">
                        <div class="activity-photo-preview" id="photos-${activity.replace(/\s+/g, '-')}">
    ${activityData.photos ? activityData.photos.map((photo, photoIndex) => `
        <div class="activity-photo-item" onclick="openPhotoPreview('${activityEscaped}', ${photoIndex}, '${photo}')">
            <img src="${photo}" alt="Photo">
            <div class="photo-overlay">
                <span class="photo-view-icon">👁</span>
            </div>
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
            dates: {}
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

// Update Activity Observation
window.updateActivityObservation = async function(activity, observation) {
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
    
    appState.junctionData[junctionId].lastUpdated = new Date().toISOString();
    await saveToFirestore(junctionId);
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

// Updated showPhotoOptions with better desktop support
window.showPhotoOptions = function(activity) {
    // Check if device is mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     ('ontouchstart' in window && window.innerWidth <= 768);
    
    if (isMobile) {
        // Show modal for mobile
        currentPhotoActivity = activity;
        const modal = document.getElementById('photoOptionsModal');
        if (modal) {
            modal.style.display = 'block';
        }
    } else {
        // Direct gallery access for desktop
        const input = document.getElementById(`photo-gallery-${activity.replace(/\s+/g, '-')}`);
        if (input) {
            input.click();
        }
    }
}

// Photo preview variables
let currentPreviewActivity = null;
let currentPreviewIndex = null;

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
    console.log('Executing delete for:', currentPreviewActivity, currentPreviewIndex); // Debug
    
    if (currentPreviewActivity !== null && currentPreviewIndex !== null) {
        try {
            await removeActivityPhoto(currentPreviewActivity, currentPreviewIndex);
            cancelPhotoDelete();
            
            // Reset preview variables
            currentPreviewActivity = null;
            currentPreviewIndex = null;
            
            showToast('Photo deleted successfully', 'success');
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
window.openPhotoPreview = function(activity, photoIndex, photoSrc) {
    currentPreviewActivity = activity;
    currentPreviewIndex = photoIndex;
    
    const modal = document.getElementById('photoPreviewModal');
    const image = document.getElementById('photoPreviewImage');
    
    if (modal && image) {
        image.src = photoSrc;
        modal.style.display = 'block';
        
        // Reset zoom and position
        currentZoom = 1;
        imageOffset = { x: 0, y: 0 };
        updateImageTransform();
        
        // Add drag functionality
        setupImageDrag(image);
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

// END OF app.js - Complete file
