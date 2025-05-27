// --- Audio Context Setup ---
let audioContext;
let masterGainNode;

// Initialize audio context on user interaction
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        masterGainNode = audioContext.createGain();
        masterGainNode.connect(audioContext.destination);
    }
    return audioContext.state === "suspended" ? audioContext.resume() : Promise.resolve();
}

// Audio buffer cache
const audioBufferCache = new Map();

// Fetch and cache audio buffer
async function getAudioBuffer(url) {
    if (audioBufferCache.has(url)) {
        return audioBufferCache.get(url);
    }
    
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        audioBufferCache.set(url, audioBuffer);
        return audioBuffer;
    } catch (error) {
        console.error('Error loading audio file:', error);
        return null;
    }
}

// Track management
let currentTrack = null;
let nextTrackTimeout = null;
const LOOP_POINT = 104; // Loop point in seconds

class MusicTrack {
    constructor(buffer, gainNode, startTime, trackVolume) {
        this.buffer = buffer;
        this.gainNode = gainNode;
        this.startTime = startTime;
        this.trackVolume = trackVolume;
        this.sources = new Set();
    }

    createSource() {
        const source = audioContext.createBufferSource();
        source.buffer = this.buffer;
        source.connect(this.gainNode);
        this.sources.add(source);
        
        source.addEventListener('ended', () => {
            this.sources.delete(source);
        });
        
        return source;
    }

    stop() {
        this.sources.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // Ignore errors from already stopped sources
            }
        });
        this.sources.clear();
        if (this.gainNode) {
            this.gainNode.disconnect();
        }
    }
}

// --- Updated Audio Playback Functions ---
// Helper function to set cookies with 6-month expiration
function setCookie(name, value) {
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    document.cookie = `${name}=${value}; expires=${sixMonths.toUTCString()}; path=/`;
}

let SKIN_COUNT = 5;

var cookies = document.cookie
    .split(';')
    .map(cookie => cookie.split('='))
    .reduce((accumulator, [key, value]) =>
    ({ ...accumulator, [key.trim()]: decodeURIComponent(value) }),
{});

const sillyNames = [
    "SailingSquid", "Captain Jellyfish", "TidalTurtle", "WaveMaster", "BuoyBouncer",
    "Marine", "MarinerMango", "Ocean Otter", "Banana Boat", "ShipShape",
    "AnchorApple", "CompassCake", "DolphinDancer", "FishFinder", "iplayseaofthieves",
    "nacho avg sailor"
];

function getRandomSillyName() {
    const adjIndex = Math.floor(Math.random() * sillyNames.length);
    return `${sillyNames[adjIndex]}`;
}

// Audio settings
if (!document.cookie.includes("musicVolume")) {
    setCookie("musicVolume", "0.5");
}
if (!document.cookie.includes("sfxVolume")) {
    setCookie("sfxVolume", "0.5");
}
if (!document.cookie.includes("playJoinSounds")) {
    setCookie("playJoinSounds", "1");
}
let musicVolume = cookies.musicVolume ? parseFloat(cookies.musicVolume) : 0.5;
let sfxVolume = cookies.sfxVolume ? parseFloat(cookies.sfxVolume) : 0.5;
let playJoinSounds = cookies.playJoinSounds !== "0";

// --- Updated Audio Handling Logic Starts ---
async function playOneShot(url, volume) {
    if (!volume) return; // Don't play if volume is 0
    await initAudioContext();
    
    try {
        const buffer = await getAudioBuffer(url);
        if (!buffer) return;
        
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        
        source.buffer = buffer;
        gainNode.gain.value = volume;
        
        source.connect(gainNode);
        gainNode.connect(masterGainNode);
        
        source.start();
        
        source.onended = () => {
            gainNode.disconnect();
        };
    } catch (error) {
        console.error("Error playing sound effect:", error, {url});
    }
}

let backgroundMusic;
let currentTrackNominalVolume = 0.5;
let currentMusicUrl = '';
let currentTrackModifier = 1.0; // Stores the modifierVolume of the current track
let activeAudioInstances = new Set();
let activeLoopTimeouts = []; // Stores IDs of pending setTimeout calls for loops

/**
 * Plays background music with precise looping at 104 seconds using Web Audio API.
 * @param {string} url - The URL of the audio file.
 * @param {number} modifierVolume - A volume modifier specific to this track.
 * @param {number} [globalVolume=musicVolume] - The base global music volume.
 */
async function playBackgroundMusic(url, modifierVolume, globalVolume = musicVolume, customLoopTime) {
    await initAudioContext();

    const AUDIO_BUFFER_OFFSET = 0.0; // Offset to ensure smooth looping
    
    currentMusicUrl = url;
    currentTrackModifier = modifierVolume;
    currentTrackNominalVolume = globalVolume * modifierVolume;

    // Stop current track if exists
    if (currentTrack) {
        currentTrack.stop();
    }
    if (nextTrackTimeout) {
        clearTimeout(nextTrackTimeout);
        nextTrackTimeout = null;
    }

    // Create new gain node for this track
    const trackGainNode = audioContext.createGain();
    trackGainNode.connect(masterGainNode);
    trackGainNode.gain.value = currentTrackNominalVolume;

    // Load and play the audio
    const buffer = await getAudioBuffer(url);
    if (!buffer) {
        console.error('Failed to load audio:', url);
        return;
    }

    function scheduleNextLoop(currentTrack) {
        const loopTime = customLoopTime || LOOP_POINT; // Use custom loop time if provided, otherwise default to LOOP_POINT
        const currentTime = audioContext.currentTime;
        const source = currentTrack.createSource();
        const startTime = currentTime;
        
        source.start(startTime);
        
        // Schedule the next loop point
        nextTrackTimeout = setTimeout(() => {
            if (currentTrack === currentTrack) { // Check if this is still the active track
                scheduleNextLoop(currentTrack);
            }
        }, (loopTime - AUDIO_BUFFER_OFFSET) * 1000); // Schedule slightly before needed to ensure smooth transition
    }    currentTrack = new MusicTrack(buffer, trackGainNode, audioContext.currentTime, currentTrackNominalVolume);
    scheduleNextLoop(currentTrack);    // Audio is now managed through the Web Audio API's AudioBufferSourceNode system
}

/**
 * Fades background music to a target volume over a specified duration using Web Audio API.
 * @param {number} targetAbsoluteVolume - The absolute target volume (0.0 to 1.0).
 * @param {number} duration - The duration of the fade in milliseconds.
 */
function fadeBackgroundMusic(targetAbsoluteVolume, duration) {
    if (!audioContext || !currentTrack) {
        return;
    }

    const now = audioContext.currentTime;
    const targetVolume = targetAbsoluteVolume * currentTrackModifier;
    
    // Apply fade to master gain for all active sources
    if (currentTrack.gainNode) {
        currentTrack.gainNode.gain.cancelScheduledValues(now);
        currentTrack.gainNode.gain.setValueAtTime(currentTrack.gainNode.gain.value, now);
        currentTrack.gainNode.gain.linearRampToValueAtTime(targetVolume, now + duration / 1000);
    }
    
    currentTrackNominalVolume = targetVolume;
}
// --- Updated Audio Handling Logic Ends ---


let skin = 1;
if (document.cookie.includes("skin")) {
    skin = parseInt(cookies.skin) || 1; // Ensure skin is a number
    const skinIdElement = document.getElementById("skin-id");
    if (skinIdElement) skinIdElement.innerHTML = "Skin #" + skin;
    const boatUr = document.getElementById("boat_ur");
    const boatUl = document.getElementById("boat_ul");
    const boatLl = document.getElementById("boat_ll");
    const boatLr = document.getElementById("boat_lr");
    if (boatUr) boatUr.src = './assets/boats/' + skin + '/ur.png';
    if (boatUl) boatUl.src = './assets/boats/' + skin + '/ul.png';
    if (boatLl) boatLl.src = './assets/boats/' + skin + '/ll.png';
    if (boatLr) boatLr.src = './assets/boats/' + skin + '/lr.png';
}

let theme = "retro";
if (document.cookie.includes("theme")) {
    const themePickerElement = document.getElementById("theme-picker");
    if (themePickerElement) themePickerElement.value = cookies.theme;
    theme = cookies.theme; // Update global theme variable

    let arrowL = document.getElementById("skin-back");
    let arrowR = document.getElementById("skin-next");
    if (arrowL) arrowL.src = "./img/arrow_" + cookies.theme + ".png";
    if (arrowR) arrowR.src = "./img/arrow_" + cookies.theme + ".png";

    let themeableElems = document.getElementsByClassName("themeable");
    for (let i = 0; i < themeableElems.length; i++) {
        themeableElems[i].classList.remove("modern", "red", "retro");
        themeableElems[i].classList.add(cookies.theme);
    }
}


let darkMode = false;
if (cookies.darkMode === "1") {
    darkMode = true; // Set global darkMode state
    let darkableElems = document.getElementsByClassName("darkable");
    for (let i = 0; i < darkableElems.length; i++) {
        darkableElems[i].classList.add("darkmode");
    }
    const darkModeToggle = document.getElementById("dark-mode-toggle");
    if (darkModeToggle) darkModeToggle.checked = true;
    
    const sqrElement = document.getElementById("sqr");
    if (sqrElement) {
        sqrElement.classList.remove("ship-display-" + theme); // Remove non-dark theme class
        sqrElement.classList.add("ship-display-" + theme + "-darkmode");
    }
} else {
    const sqrElement = document.getElementById("sqr");
    if (sqrElement) {
      sqrElement.classList.add("ship-display-" + theme);
    }
}


const gameCodeLength = 4;

window.mobileAndTabletCheck = function() {
  let check = false;
  (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||window.opera);
  return check;
};

let isMobileUser = window.mobileAndTabletCheck();

if (isMobileUser) {
    let desktopElems = document.getElementsByClassName("desktop-only");
    for (let i = 0; i < desktopElems.length; i++) {
        desktopElems[i].classList.add("hidden");
    }
} else {
    let mobileElems = document.getElementsByClassName("mobile-only");
    for (let i = 0; i < mobileElems.length; i++) {
        mobileElems[i].classList.add("hidden");
    }
    const sqrElement = document.getElementById("sqr");
    if (sqrElement) sqrElement.classList.add("grid");
    const rootElement = document.getElementById("root");
    if (rootElement) {
        rootElement.classList.add("flex-center");
        rootElement.classList.remove("column");
    }
}

// Global player management
let players = [];
let isHost = false;
let gameStarting = false;
let gameStarted = false;
let gameEndTimeout = null;
const GAME_DURATION = 60000; // 60 seconds

function addPlayer(name, skinId, isHostPlayer = false) {
    if (isHostPlayer) {
        isHost = true;
        const startButton = document.getElementById('start-game-button');
        if (startButton) {
            startButton.style.display = 'block';
            startButton.addEventListener('click', () => {
                if (players.length >= 0) { // Allow starting with just the host
                    if (typeof networkManager !== 'undefined') {
                        socket.emit('gameStart');  // Emit the gameStart event directly
                        startGame();
                    } else {
                        console.error("networkManager not available for starting game");
                    }
                } else {
                    const errorMsgElement = document.getElementById('error-message');
                    if(errorMsgElement) {
                        errorMsgElement.textContent = "Error starting game";
                        errorMsgElement.style.display = 'block';
                        setTimeout(() => { errorMsgElement.style.display = 'none'; }, 3000);
                    }
                }
            });
            updateStartButtonState();  // Initialize button state
        }
        return;
    }
    players.push({ name, skinId });
    updatePlayerList();
}

function updatePlayerList() {
    const playerList = document.getElementById('player-list');
    if (!playerList) return;
    
    playerList.innerHTML = '';
    
    const header = document.createElement('h2');
    header.textContent = `Players (${players.length})`;
    playerList.appendChild(header);
    
    players.forEach(player => {
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';
        playerItem.dataset.name = player.name;
        
        const boatImg = document.createElement('img');
        boatImg.src = `./assets/boats/${player.skinId}/icon.png`;
        
        const playerName = document.createElement('span');
        playerName.textContent = player.name;
        
        playerItem.appendChild(boatImg);
        playerItem.appendChild(playerName);
        playerList.appendChild(playerItem);
    });
}

function addPlayerToList(name, skinId) {
    const playerList = document.getElementById('player-list');
    if (!playerList) return;
    
    players.push({ name, skinId });
    updatePlayerList();
    
    const playerItem = playerList.querySelector(`[data-name="${name}"]`);
    if (playerItem) {
        playerItem.classList.add('highlight');
        setTimeout(() => playerItem.classList.remove('highlight'), 2000);
    }
    
    if (playJoinSounds) {
        playOneShot(getRandomJoinSound(), 0.3 * sfxVolume);
    }
}

function removePlayerFromList(name) {
    const playerList = document.getElementById('player-list');
    if (!playerList) return;
    
    players = players.filter(p => p.name !== name);
    updatePlayerList();
    
    if (playJoinSounds) {
        playOneShot('./assets/audio/player_leave.mp3', 0.1 * sfxVolume);
    }
}

function updatePlayerCount() {
    const playerList = document.getElementById('player-list');
    const playerCountDisplay = document.getElementById('player-count'); // Renamed for clarity
    const header = playerList?.querySelector('h2');
    
    if (!playerList) return;
    
    const count = players.length;

    if (playerCountDisplay) {
        playerCountDisplay.textContent = `Players: ${count}`;
    }
    
    if (header) {
        header.textContent = `Players (${count})`;
    }

    const sqrElement = document.getElementById("sqr");
    if (sqrElement) { // Removed playerCount null check as it's not directly used for sqrElement styling
        const playerAreaSide = 2;
        const spacingLogCoefficient = 0.5;
        const offset = 4;
        const logAlgorithm = 100 / ((playerAreaSide + spacingLogCoefficient * Math.log(count)) * Math.sqrt(count) + offset);
        const linearAlgorithm = 100 / ((playerAreaSide * count) + offset);
        const division = (count > 2 ? (linearAlgorithm) : (100/8));
        

        // Ensure the final side length is a multiple of playerAreaSide.
        // This is achieved by dividing by playerAreaSide, taking the ceiling,
        // and then multiplying back. This rounds rawCalculatedSide UP to the nearest multiple of playerAreaSide.
        // This also ensures that the boardSide is at least playerAreaSide, because:
        // - If rawCalculatedSide is playerAreaSide (for numPlayers=1), boardSide becomes playerAreaSide.
        // - If rawCalculatedSide is very small but positive (e.g. due to an unusual coefficient, though not intended here),
        //   Math.ceil(small_positive_val / playerAreaSide) will be 1 (assuming playerAreaSide > 0),
        //   so boardSide becomes playerAreaSide.
        
        sqrElement.style.backgroundSize = `${division}% ${division}%, ${division}% ${division}%, 20% 20%`;
    }
}


if (typeof networkManager !== 'undefined') {
    networkManager.setCallbacks({        onPlayerJoined: (name, skinId) => {
            addPlayerToList(name, skinId);
            updatePlayerCount();
            
            // Enable start button for host if enough players
            if (isHost) {
                const startButton = document.getElementById('start-game-button');
                if (startButton) {
                    startButton.disabled = !canStartGame();
                }
            }
        },
        onPlayerLeft: (name) => {
            removePlayerFromList(name);
            updatePlayerCount();
            
            // Disable start button for host if not enough players
            if (isHost) {
                const startButton = document.getElementById('start-game-button');
                if (startButton) {
                    startButton.disabled = !canStartGame();
                }
            }
        },
        onPlayerInfoUpdate: (oldName, newName, newSkinId) => {
            const player = players.find(p => p.name === oldName);
            if (player) {
                const playerItem = document.querySelector(`[data-name="${oldName}"]`);
                if (playerItem) {
                    if (newName) {
                        player.name = newName;
                        playerItem.dataset.name = newName;
                        const nameSpan = playerItem.querySelector('span');
                        if (nameSpan) nameSpan.classList.add('nickname-changed');
                        setTimeout(() => { if (nameSpan) nameSpan.classList.remove('nickname-changed'); }, 2000);
                    }
                    if (newSkinId !== undefined && newSkinId !== player.skinId) {
                        player.skinId = newSkinId;
                        const boatImg = playerItem.querySelector('img');
                        if (boatImg) {
                            boatImg.src = `./assets/boats/${newSkinId}/icon.png`;
                            boatImg.classList.add('skin-changed');
                            setTimeout(() => boatImg.classList.remove('skin-changed'), 2000);
                        }
                    }
                }
                updatePlayerList();
            }
        },
        onGameStarting: () => {
            startGame();
        },
        onRoomClosed: () => { // New handler for host disconnection
            resetGameState();
        }
    });
} else {
    console.warn("networkManager is not defined. Callbacks not set.");
}


if (!isMobileUser) {
    const settingsModal = document.getElementById('settings-modal');
    const settingsBtnDesktop = document.getElementById('settings-btn-desktop');
    const closeSettingsBtn = document.getElementById('close-settings'); // Renamed for clarity
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const createLobbyBtn = document.getElementById('create-lobby');
    const lobbyOverlay = document.getElementById('lobby-overlay');
    const roomCodeDisplay = document.getElementById('room-code');

    function openSettings() {
        if (settingsModal) settingsModal.style.display = 'block';
    }

    function closeSettingsModal() {
        if (settingsModal) settingsModal.style.display = 'none';
    }

    if (tabButtons.length > 0 && tabPanels.length > 0) {
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanels.forEach(panel => panel.classList.remove('active'));
                button.classList.add('active');
                const tabName = button.getAttribute('data-tab');
                const targetPanel = document.getElementById(tabName + '-tab');
                if (targetPanel) targetPanel.classList.add('active');
            });
        });
    }
        
    if (document.getElementById('player-list')) {
        updatePlayerList();
    }

    if (createLobbyBtn) {
        createLobbyBtn.addEventListener('click', () => {
            const code = generateRoomCode();
            if (roomCodeDisplay) roomCodeDisplay.textContent = "Room Code: " + code;
            if (lobbyOverlay) lobbyOverlay.style.display = 'none';
            if (typeof networkManager !== 'undefined') {
                networkManager.createRoom(code, skin);
            } else {
                console.error("networkManager not available for createRoom");
            }
            addPlayer('You (Host)', skin, true);
            playBackgroundMusic('./assets/audio/lobby_music.mp3', 0.4, musicVolume, 104);
        });
    }

    if (settingsBtnDesktop) settingsBtnDesktop.addEventListener('click', openSettings);
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsModal);

    window.addEventListener('click', (event) => {
        if (settingsModal && event.target === settingsModal) {
            closeSettingsModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (settingsModal && settingsModal.style.display === 'block') {
                closeSettingsModal();
            } else if (!isMobileUser && settingsBtnDesktop) {
                openSettings();
            }
        }
    });
}


function getRandomJoinSound() {
    const joinSounds = [
        './assets/audio/player_join_1.mp3',
        './assets/audio/player_join_2.mp3',
        './assets/audio/player_join_3.mp3'
    ];
    return joinSounds[Math.floor(Math.random() * joinSounds.length)];
}

let lastCountdownSound = '';
function getRandomCountdownSound() {
    const countdownSounds = [
        './assets/audio/game_countdown_1.mp3', './assets/audio/game_countdown_2.mp3',
        './assets/audio/game_countdown_3.mp3', './assets/audio/game_countdown_4.mp3',
        './assets/audio/game_countdown_5.mp3'
    ];
    let availableSounds = countdownSounds.filter(sound => sound !== lastCountdownSound);
    if (availableSounds.length === 0) availableSounds = countdownSounds;
    const selectedSound = availableSounds[Math.floor(Math.random() * availableSounds.length)];
    lastCountdownSound = selectedSound;
    return selectedSound;
}

let takenPFPs = [];
function getRandomPFP() {
    // Array of all possible profile picture paths
    const allPFPs = [
        './assets/pfp/pfp_1.png',
        './assets/pfp/pfp_2.png',
        './assets/pfp/pfp_3.png',
        './assets/pfp/pfp_4.png',
        './assets/pfp/pfp_5.png',
        './assets/pfp/pfp_6.png',
        './assets/pfp/pfp_7.png',
        './assets/pfp/pfp_8.png'
    ];
    
    // Filter out already taken PFPs
    let availablePFPs = allPFPs.filter(pfp => !takenPFPs.includes(pfp));
    
    // If all PFPs are taken, reset the taken list and use all PFPs
    if (availablePFPs.length === 0) {
        takenPFPs = [];
        availablePFPs = allPFPs;
    }
    
    // Select a random PFP from available ones
    const selectedPFP = availablePFPs[Math.floor(Math.random() * availablePFPs.length)];
    takenPFPs.push(selectedPFP);
    return selectedPFP;
}

function getRandomStartSound() {
    const startSounds = [ // Corrected variable name
        './assets/audio/game_start_1.mp3', './assets/audio/game_start_2.mp3',
        './assets/audio/game_start_3.mp3'
    ];
    return startSounds[Math.floor(Math.random() * startSounds.length)];
}

function generateRoomCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUWXYZ';
    const badWords = ['FUCK', 'FVCK', 'SHIT', 'DAMN', 'CUNT', 'DICK', 'COCK', 'TWAT', 'CRAP','STFU'];
    while (true) {
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        if (!badWords.some(word => code.includes(word))) return code;
    }
}

const gameCodeInput = document.getElementById("game-code");
if (gameCodeInput) {
    gameCodeInput.addEventListener('input', function(event) {
        const joinBtn = document.getElementById("join-button"); // Renamed for clarity
        if (joinBtn) {
            joinBtn.disabled = event.target.value.length !== gameCodeLength;
        }
    });
}

let settingsOpen = false;
let settingsDiv = document.getElementById("settings-div");
let settingsBtn = document.getElementById("settings-button");
let touchStartY = 0;
let touchEndY = 0;
const minSwipeDistance = 50;
let settingsOpenSFX = document.getElementById("settings-open-sfx");
let settingsCloseSFX = document.getElementById("settings-close-sfx");

function toggleSettings(open) {
    if (settingsBtn && settingsDiv) {
        if (open && !settingsOpen) {
            if (settingsOpenSFX && settingsOpenSFX.play) settingsOpenSFX.play();
            settingsBtn.style.top = "75%";
            settingsDiv.style.top = "85%";
            settingsOpen = true;
        } else if (!open && settingsOpen) {
            if (settingsCloseSFX && settingsCloseSFX.play) settingsCloseSFX.play();
            settingsBtn.style.top = "90%";
            settingsDiv.style.top = "100%";
            settingsOpen = false;
        }
    }
}

function handleTouchStart(event) { touchStartY = event.touches[0].clientY; }
function handleTouchEnd(event) {
    touchEndY = event.changedTouches[0].clientY;
    const swipeDistance = touchEndY - touchStartY;
    if (Math.abs(swipeDistance) >= minSwipeDistance) {
        if (swipeDistance > 0 && settingsOpen) toggleSettings(false);
        else if (swipeDistance < 0 && !settingsOpen) toggleSettings(true);
    }
}

if (settingsBtn) {
    settingsBtn.addEventListener('touchstart', handleTouchStart);
    settingsBtn.addEventListener('touchend', handleTouchEnd);
    settingsBtn.addEventListener('click', () => toggleSettings(!settingsOpen));
}
if (settingsDiv) {
    settingsDiv.addEventListener('touchstart', handleTouchStart);
    settingsDiv.addEventListener('touchend', handleTouchEnd);
}

let darkModeSwitch = document.getElementById("dark-mode-toggle");
if (darkModeSwitch) {
    darkModeSwitch.addEventListener('change', function(event) {
        toggleDarkMode(event.target.checked);
        const desktopSwitch = document.getElementById("dark-mode-toggle-desktop");
        if (desktopSwitch) desktopSwitch.checked = event.target.checked;
    });
}

let themePicker = document.getElementById("theme-picker");
if (themePicker) {
    themePicker.addEventListener('change', function(event) {
        theme = event.target.value;
        let arrowL = document.getElementById("skin-back");
        let arrowR = document.getElementById("skin-next");
        if (arrowL) arrowL.src = "./img/arrow_" + theme + ".png";
        if (arrowR) arrowR.src = "./img/arrow_" + theme + ".png";
        
        const sqrElement = document.getElementById("sqr");
        if (sqrElement) {
            sqrElement.className = 'ship-display-base'; // Reset classes then add specific ones
            if (isMobileUser) sqrElement.classList.add("ship-display"); else sqrElement.classList.add("grid");
            sqrElement.classList.add(darkMode ? "ship-display-" + theme + "-darkmode" : "ship-display-" + theme);
        }

        let themeableElems = document.getElementsByClassName("themeable");
        for (let i = 0; i < themeableElems.length; i++) {
            themeableElems[i].classList.remove("modern", "red", "retro");
            themeableElems[i].classList.add(theme);
        }
        setCookie("theme", theme);
    });
}

let currentPlayerName = cookies.nickname || getRandomSillyName();

let nicknameInput = document.getElementById('nickname');
if (nicknameInput) {
    nicknameInput.value = currentPlayerName; // Set from already initialized currentPlayerName
    nicknameInput.addEventListener('input', function(event) {
        const newNickname = event.target.value.trim();
        if (newNickname && newNickname !== currentPlayerName) { // Only update if changed
            const oldNickname = currentPlayerName;
            currentPlayerName = newNickname;
            setCookie("nickname", newNickname);
            if (typeof networkManager !== 'undefined') {
                networkManager.updatePlayerInfo({ oldName: oldNickname, newNickname: newNickname });
            }
        }
    });
}

const joinButton = document.getElementById('join-button');
if (gameCodeInput && joinButton) {
    gameCodeInput.addEventListener('input', function(event) {
        const value = event.target.value.toUpperCase();
        event.target.value = value; // Force uppercase
        joinButton.disabled = value.length !== gameCodeLength;
    });

    joinButton.addEventListener('click', function() {
        const roomCode = gameCodeInput.value; // Already uppercase
        if (roomCode.length === gameCodeLength) {
            const nickname = nicknameInput ? nicknameInput.value.trim() : getRandomSillyName();
            if (!nickname) { // If nickname became empty after trim
                currentPlayerName = getRandomSillyName();
                if(nicknameInput) nicknameInput.value = currentPlayerName;
            } else {
                currentPlayerName = nickname;
            }
            if (typeof networkManager !== 'undefined') {
                networkManager.joinRoom(roomCode, currentPlayerName, skin);
            } else {
                console.error("networkManager not available for joinRoom");
            }
        }
    });
}

if (!document.getElementById('error-message')) {
    const errorDiv = document.createElement('div');
    errorDiv.id = 'error-message';
    errorDiv.style.cssText = 'display: none; color: red; position: fixed; top: 20%; left: 50%; transform: translateX(-50%); z-index: 1000; background-color: #ffdddd; padding: 10px; border-radius: 5px; border: 1px solid red;';
    document.body.appendChild(errorDiv);
}

if (!isMobileUser) {
    const musicVolumeSlider = document.getElementById('music-volume');
    const sfxVolumeSlider = document.getElementById('sfx-volume');
    const playJoinSoundsToggle = document.getElementById('play-join-sounds');

    if (musicVolumeSlider) {
        musicVolumeSlider.value = musicVolume * 100;
        musicVolumeSlider.addEventListener('input', (e) => {
            musicVolume = parseFloat(e.target.value) / 100; // Ensure float
            // Update nominal volume for the current track using its specific modifier
            currentTrackNominalVolume = musicVolume * currentTrackModifier;
            activeAudioInstances.forEach(audio => {
                audio.volume = currentTrackNominalVolume;
            });
            setCookie("musicVolume", musicVolume.toString());
        });
    }

    if (sfxVolumeSlider) {
        sfxVolumeSlider.value = sfxVolume * 100;
        sfxVolumeSlider.addEventListener('input', (e) => {
            sfxVolume = parseFloat(e.target.value) / 100; // Ensure float
            setCookie("sfxVolume", sfxVolume.toString());
        });
    }

    if (playJoinSoundsToggle) {
        playJoinSoundsToggle.checked = playJoinSounds;
        playJoinSoundsToggle.addEventListener('change', (e) => {
            playJoinSounds = e.target.checked;
            setCookie("playJoinSounds", (playJoinSounds ? "1" : "0"));
        });
    }
}

// Update host controls
function canStartGame() {
    return players.length >= 0; // Allow starting with just the host
}

function updateStartButtonState() {
    if (!isHost) return;
    
    const startButton = document.getElementById('start-game-button');
    if (startButton) {
        startButton.disabled = !canStartGame();
    }
}

function startGame() {
    gameStarted = true;
    
    // Hide UI elements
    const nicknameInput = document.getElementById('nickname');
    const settingsButton = document.getElementById('settings-button');
    const settingsDiv = document.getElementById('settings-div');
    const startGameButton = document.getElementById('start-game-button');

    if (nicknameInput) nicknameInput.style.display = 'none';
    if (startGameButton) startGameButton.style.display = 'none';
    if (settingsButton) settingsButton.style.display = 'none';
    if (settingsDiv) settingsDiv.style.display = 'none';

    // Start background music and timer
    if (isHost) {
        playBackgroundMusic('./assets/audio/game_music.mp3', 0.4, musicVolume);
        startGameTimer();
    }
    
    // Show tap instructions
    const instructions = document.createElement('div');
    instructions.className = 'tap-instructions darkable';
    instructions.textContent = isMobileUser ? 'Tap anywhere to play!' : 'Watch your friends tap!';
    document.body.appendChild(instructions);
    setTimeout(() => instructions.remove(), 3000);
}

if (typeof networkManager !== 'undefined') {
    networkManager.setCallbacks({
        onPlayerJoined: (name, skinId) => {
            addPlayerToList(name, skinId);
            updatePlayerCount();
            
            // Enable start button for host if enough players
            if (isHost) {
                const startButton = document.getElementById('start-game-button');
                if (startButton) {
                    startButton.disabled = !canStartGame();
                }
            }
        },
        onPlayerLeft: (name) => {
            removePlayerFromList(name);
            updatePlayerCount();
            
            // Disable start button for host if not enough players
            if (isHost) {
                const startButton = document.getElementById('start-game-button');
                if (startButton) {
                    startButton.disabled = !canStartGame();
                }
            }
        },
        onPlayerInfoUpdate: (oldName, newName, newSkinId) => {
            const player = players.find(p => p.name === oldName);
            if (player) {
                const playerItem = document.querySelector(`[data-name="${oldName}"]`);
                if (playerItem) {
                    if (newName) {
                        player.name = newName;
                        playerItem.dataset.name = newName;
                        const nameSpan = playerItem.querySelector('span');
                        if (nameSpan) nameSpan.classList.add('nickname-changed');
                        setTimeout(() => { if (nameSpan) nameSpan.classList.remove('nickname-changed'); }, 2000);
                    }
                    if (newSkinId !== undefined && newSkinId !== player.skinId) {
                        player.skinId = newSkinId;
                        const boatImg = playerItem.querySelector('img');
                        if (boatImg) {
                            boatImg.src = `./assets/boats/${newSkinId}/icon.png`;
                            boatImg.classList.add('skin-changed');
                            setTimeout(() => boatImg.classList.remove('skin-changed'), 2000);
                        }
                    }
                }
                updatePlayerList();
            }
        },
        onGameStarting: () => {
            startGame();
        },
        onRoomClosed: () => {
            resetGameState();
        }
    });
} else {
    console.warn("networkManager is not defined. Callbacks not set.");
}

function startGameTimer() {
    if (!isHost || !gameStarted) return;
    
    gameEndTimeout = setTimeout(() => {
        if (typeof networkManager !== 'undefined') {
            networkManager.updateGameState({ gameEnded: true });
        }
        endGame();
    }, GAME_DURATION);
}

function endGame() {
    gameStarted = false;
    if (gameEndTimeout) {
        clearTimeout(gameEndTimeout);
        gameEndTimeout = null;
    }

    // Find the winner
    let maxTaps = 0;
    let winner = null;
    document.querySelectorAll('.player-cell').forEach(cell => {
        const taps = parseInt(cell.querySelector('.tap-counter').textContent) || 0;
        if (taps > maxTaps) {
            maxTaps = taps;
            winner = cell.querySelector('.player-name').textContent;
        }
    });

    // Show winner
    const winnerModal = document.createElement('div');
    winnerModal.className = 'modal';
    winnerModal.innerHTML = `
        <div class="modal-content darkable themeable">
            <h2>Game Over!</h2>
            <p>${winner} wins with ${maxTaps} taps!</p>
            <button onclick="location.reload()">Play Again</button>
        </div>
    `;
    document.body.appendChild(winnerModal);
    winnerModal.style.display = 'block';

    // Stop game music and play victory sound
    if (currentTrack) {
        currentTrack.stop();
    }
    playOneShot('./assets/audio/victory.mp3', 0.3 * sfxVolume);
}

function resetGameState() {
    players = [];
    updatePlayerList();
    gameStarting = false;
    
    document.querySelectorAll('.suit-square').forEach(square => {
        square.style.pointerEvents = 'auto';
        square.style.opacity = '1';
    });
    
    fadeBackgroundMusic(currentTrackNominalVolume, 2000);
}

// --- Player Grid Management ---
function createPlayerCell(playerId, playerName) {
    const cell = document.createElement('div');
    cell.className = 'player-cell darkable';
    cell.id = `player-${playerId}`;
    cell.innerHTML = `
        <div class="player-name">${playerName}</div>
        <div class="tap-counter">0</div>
        <div class="player-flash"></div>
    `;
    return cell;
}

function updatePlayerGrid() {
    const grid = document.querySelector('.player-grid');
    if (!grid) return;

    // Clear existing grid
    grid.innerHTML = '';
    
    // Add cells for all players
    players.forEach(player => {
        const cell = createPlayerCell(player.id, player.name);
        grid.appendChild(cell);
    });

    // Update grid columns based on player count
    const columns = Math.ceil(Math.sqrt(players.length));
    grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
}

function showTapEffect(playerId) {
    const cell = document.getElementById(`player-${playerId}`);
    if (!cell) return;

    const flash = cell.querySelector('.player-flash');
    if (!flash) return;

    // Reset animation
    flash.classList.remove('active');
    void flash.offsetWidth; // Trigger reflow
    flash.classList.add('active');

    // Update tap counter
    const counter = cell.querySelector('.tap-counter');
    if (counter) {
        const currentCount = parseInt(counter.textContent) || 0;
        counter.textContent = currentCount + 1;
    }

    // Play tap sound
    playOneShot('./assets/audio/tap.mp3', 0.2 * sfxVolume);
}

// Handle tap events
if (isMobileUser) {
    document.addEventListener('touchstart', () => {
        if (!gameStarted) return;
        
        if (typeof networkManager !== 'undefined') {
            networkManager.sendTap();
        }
    });
}

// Update networking callbacks
if (typeof networkManager !== 'undefined') {
    const callbacks = {
        onPlayerJoined: networkManager.getCallbacks().onPlayerJoined,
        onPlayerLeft: networkManager.getCallbacks().onPlayerLeft,
        onReadyStateUpdate: networkManager.getCallbacks().onReadyStateUpdate,
        onPlayerInfoUpdate: networkManager.getCallbacks().onPlayerInfoUpdate,
        onGameStarting: networkManager.getCallbacks().onGameStarting,
        onRoomClosed: networkManager.getCallbacks().onRoomClosed,
        onTapEvent: (data) => {
            showTapEffect(data.playerId);
        },
        onGameStateUpdate: (data) => {
            // Handle any game state updates from host
            if (data.gameEnded) {
                endGame();
            }
        }
    };
    networkManager.setCallbacks(callbacks);
}


