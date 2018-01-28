"use strict";

var socket = null;
const DefaultSongText = 'Select a station';

var timer = {
    // All in ms
    mpdLastUpdate: 0,
    lastMpdUpdateTimestamp: 0,

    displayedTime: 0,
    lastDisplayTimestamp: 0
};

Vue.component('radio-station', {
    props: ['station']
})  

var app = new Vue({
    el: '#app',
    data: {
        stationList: [ ],
        status: 'loading', // playing, stopped, paused
        elapsed: '0:00',
        song: DefaultSongText,
        currentStation: null
    },
    created: function () {
        this.connectWSS();
        this.updateElapsed();
    },
    methods: {
        connectWSS: function() {
            var self = this;

            // Connect to WebSocket server
            var url = 'ws://'+location.hostname+(location.port ? ':'+location.port: '');
            socket = new ReconnectingWebSocket(url, null, {reconnectInterval: 3000});

            socket.onopen = function () {
                sendWSSMessage('REQUEST_STATION_LIST', null);
                sendWSSMessage('REQUEST_STATUS', null);
            };

            socket.onmessage = function (message) {
                var msg = JSON.parse(message.data);
                switch(msg.type) {
                    case "STATION_LIST":
                        self.stationList = msg.data;
                        break;
                    case "STATUS":
                        timer.lastDisplayTimestamp = 0;
                        self.setPlayState(msg.data.state);
                        self.setCurrentStation(msg.data.file);
                        self.setSongName(msg.data.title, msg.data.album, msg.data.artist);
                        self.setElapsedTime(msg.data.elapsed);
                        break;
                    case "ELAPSED":
                        self.setElapsedTime(msg.data.elapsed);
                        break;
                }
            };

            socket.onerror = socket.onclose = function(err) {
                // console.log('close / error');
            };
        },

        onPlayButton: function(event) {
            var self = this;
            switch(self.status) {
                case 'playing':
                    self.status = 'loading';
                    sendWSSMessage('PAUSE', null);
                    break;
                case 'stopped':
                case 'paused':
                    self.status = 'loading';
                    sendWSSMessage('PLAY', null);
                    break;
                default:
                    sendWSSMessage('REQUEST_STATUS', null);
                    break;
            }
        },

        onPlayStation: function(stream) {
            var self = this;
            self.status = 'loading';
            self.currentStation = null;
            self.elapsed = '0:00';
            self.song = "";
            sendWSSMessage('PLAY', { stream: stream });
        },

        updateElapsed: function() {
            var self = this;
            var timeout = 1000;
            if(self.status === 'playing') {
                // Last MPD update + the time passed since then
                var bestGuessOnMpdTime = (timer.mpdLastUpdate + Date.now() - timer.lastMpdUpdateTimestamp);
        
                if(timer.lastDisplayTimestamp <= 0) {
                    // Initialize display to latest MPD update + the time passed since then
                    timer.displayedTime = bestGuessOnMpdTime;
                    timer.lastDisplayTimestamp = Date.now();
                }
                // Advance displayed timer by the time passed since it has been last updated for the user
                timer.displayedTime += Math.max(Date.now() - timer.lastDisplayTimestamp, 0);
        
                // Calculate difference to best guess
                var delta = timer.displayedTime - bestGuessOnMpdTime;
        
                if(Math.abs(delta) > 3000) {
                    timer.displayedTime = bestGuessOnMpdTime;
                } else {
                    var timeoutShorterToRecoverIn10Secs = delta / 10;
                    timeout = Math.min(Math.max(timeout - timeoutShorterToRecoverIn10Secs, 0), 2000);
                    timer.displayedTime -= timeoutShorterToRecoverIn10Secs;
                }        
            } else if(self.status === 'paused') {
                timer.displayedTime = timer.mpdLastUpdate;
            } else {
                timer.displayedTime = 0;
            }
        
            self.changeDisplayTimer(timer.displayedTime);
            timer.lastDisplayTimestamp = Date.now();
        
            setTimeout(() => {
                self.updateElapsed();
            }, timeout);

            if(self.status === 'playing' && (Date.now() - timer.lastMpdUpdateTimestamp) > 10000) {
                sendWSSMessage('REQUEST_ELAPSED', null);
            }
        }, 

        setElapsedTime: function(elapsed) {
            if(!isNaN(parseFloat(elapsed)) && isFinite(elapsed)) {
                timer.mpdLastUpdate = elapsed * 1000;
            } else {
                timer.mpdLastUpdate = 0;
            }
            timer.lastMpdUpdateTimestamp = Date.now();
        },

        setPlayState: function(state) {
            switch(state) {
                case 'play':
                    this.status = 'playing';
                    break;
                case 'stop':
                    this.status = 'stopped';
                    break;
                case 'pause':
                    this.status = 'paused';
                    break;
                default:
                    this.status = 'loading';
                    break;
            }
        },

        setCurrentStation: function(file) {
            var self = this;
            var found = false;
            self.stationList.forEach(station => {
                if(station.stream === file) {
                    found = true;
                    // Don't do anything if the station did not chnage
                    if(!self.currentStation || self.currentStation.stream === file)
                        self.currentStation = station;
                    return;
                }
            });
            if(!found) {
                self.song = DefaultSongText;
                self.currentStation = null;
            }
        },

        setSongName: function(title, album, artist) {
            if(!title && !album && !artist && !this.currentStation) {
                this.song = DefaultSongText;
            } else {
                var text = '';
                if(typeof artist != 'undefined' && artist.length > 0) {
                    text = artist;
                }
                if(typeof album != 'undefined' && album.length > 0) {
                    text += ((text.length > 0) ? ' - ' : '') + album;
                }
                if(typeof title != 'undefined' && title.length > 0) {
                    text += ((text.length > 0) ? ' - ' : '') + title;
                }
                this.song = text;
            }
        },

        changeDisplayTimer: function(ms) {
            var timeInSec = ms/1000;
            var hours = Math.floor(timeInSec / 3600);
            var minutes = Math.floor((timeInSec / 60) - (hours * 60));
            var seconds = Math.floor(timeInSec - (hours * 3600) - (minutes * 60));
            var strToDisplay = (hours > 0) ? (hours+':') : '';
            strToDisplay += (hours > 0 && minutes < 10) ? ('0' + minutes + ':') : (minutes + ':');
            strToDisplay += (seconds < 10 ? '0' : '') + seconds;
            this.elapsed = strToDisplay;
        }
    }
})

function sendWSSMessage(type, data) {
    var msg = {
        type: type,
        data: (data) ? data : {}
    }
    socket.send(JSON.stringify(msg));
}