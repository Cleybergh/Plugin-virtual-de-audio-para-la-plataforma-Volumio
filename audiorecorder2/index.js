'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
const mm = require('music-metadata');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var path = require('path');

module.exports = audiorecorder2;
function audiorecorder2(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;

	self.filePath = '/home/volumio/recordings/';
    self.fileName = 'output.wav';

    self.state = 'stop'; // Estados: 'stop', 'play', 'pause' o 'recording'
    self.recordProcess = null;

}



audiorecorder2.prototype.onVolumioStart = function()
{
	var self = this;
	var defer=libQ.defer();
	self.logger.info('Entrando en onVolumioStart');
	//var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	self.config.set('file_path', '/home/volumio/recordings/');
    self.config.set('file_name', 'output.wav');
	
	//this.config.loadFile(configFile);
	defer.resolve();

    return defer.promise;
}

audiorecorder2.prototype.onStart = function() {
    var self = this;
    var defer=libQ.defer();
	self.commandRouter.logger.info('onStart ha sido llamado.');

	self.logger.info('audiorecorder2::onStart ha sido llamado');
    //self.loadConfig();
    //self.commandRouter.volumioSetActiveService('audiorecorder2');

    self.logger.info('🔊 Configurando ALSA para control de volumen...');
    
    // 🔹 Reescribir asound.conf dinámicamente
    let asoundConfig = `
pcm.!default {
    type             empty
    slave.pcm       "volumio"
}

pcm.volumio {
    type             empty
    slave.pcm       "volumioSoftvol"
}

pcm.volumioSoftvol {
    type softvol
    slave.pcm "volumioOutput"
    control {
        name "Master"
        card "pisound"
    }
    min_dB -51.0
    max_dB 0.0
}

pcm.volumioOutput {
    type plug
    slave.pcm "volumioHw"
}

pcm.volumioHw {
    type hw
    card "pisound"
}

ctl.!default {
    type hw
    card "pisound"
}
`;

    fs.writeFileSync('/etc/asound.conf', asoundConfig);
    self.logger.info('✅ asound.conf reescrito correctamente.');

    // 🔹 Aplicar configuración de ALSA
    exec('sudo alsactl restore', (error, stdout, stderr) => {
        if (error) {
            self.logger.error(`❌ Error al restaurar ALSA: ${stderr}`);
        } else {
            self.logger.info('✅ Configuración de ALSA restaurada.');
        }
    }); 

    // 🔹 Indicar que el servicio soporta volumen
    self.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'setConfigParam', {
        key: 'volumesteps',
        value: 100  // 🔹 Define 100 pasos de volumen (0-100%)
    });

    // 🔹 Sincronizar volumen del sistema con la barra de Volumio
    self.syncVolumeOnStart();

    self.logger.info('🔊 Control de volumen habilitado.');

	// Registrar la fuente de música en Volumio
    self.addToBrowseSources();
 
    // Restaurar configuración de ALSA en caso de ser sobrescrita
    self.commandRouter.sharedVars.registerCallback('alsa.outputdevice', (outputDevice) => {
        self.logger.info(`🔄 Cambio detectado en la salida de audio: ${outputDevice}`);
        self.restoreAsoundConfig();
    });

	// Registrar los listeners para los botones del plugin
    self.registerListeners();

    // Registrar los listeners de reproducción
    //self.registerPlaybackListeners();
    
    //let lastSeek = 0;
    let seekTimeout = null;

    self.commandRouter.volumioSeek = function (position) {
        self.logger.info(`🎯 volumioSeek interceptado: ${position} s`);
    
        // 🔹 Cancelar cualquier ejecución previa si el usuario sigue moviendo el cursor
        if (self.seekTimeout) {
            clearTimeout(self.seekTimeout);
        }
    
        // 🔹 Esperar 300ms antes de ejecutar seek(), asegurando que el usuario haya soltado el cursor
        self.seekTimeout = setTimeout(() => {
          //  lastSeek = position;
            self.seek(position*1000);
        }, 300);
    };
    
	// Once the Plugin has successfull started resolve the promise
	defer.resolve();

    return defer.promise;
};

audiorecorder2.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();
	self.logger.info('audiorecorder2::onStop ha sido llamado. ELiminando "Mis grabaciones."');
    // Once the Plugin has successfull stopped resolve the promise

    // Eliminar "Mis Grabaciones" de la sección "Browse"
    self.commandRouter.volumioRemoveToBrowseSources('audiorecorder2');

    // Intentar forzar una actualización de la interfaz
    self.commandRouter.executeOnPlugin('music_service', 'mpd', 'clear');

    defer.resolve();

    return libQ.resolve();
};

audiorecorder2.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};

audiorecorder2.prototype.syncVolumeOnStart = function () {
    var self = this;

    exec("amixer get Master | grep -o '[0-9]*%'", (error, stdout, stderr) => {
        if (error) {
            self.logger.error("❌ Error al obtener el volumen de ALSA: " + stderr);
        } else {
            let volume = parseInt(stdout.replace('%', '').trim());
            if (!isNaN(volume)) {
                self.logger.info(`🔊 Sincronizando volumen inicial con Volumio: ${volume}%`);
                self.setVolume(volume);
            }
        }
    });
    
};

audiorecorder2.prototype.restoreAsoundConfig = function() {
    var self = this;
    const configFilePath = "/data/configuration/audio_interface/alsa_controller/config.json";

    // 📌 Monitorear cambios en config.json
    fs.watchFile(configFilePath, { interval: 1000 }, (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
            // 📌 Leer la nueva configuración
            fs.readFile(configFilePath, 'utf8', (err, data) => {
                if (err) {
                    self.logger.error(`❌ Error al leer config.json: ${err}`);
                    return;
                }

                try {
                    const config = JSON.parse(data);
                    const outputDeviceName = config.outputdevicename.value || "";
                    const outputDevice = config.outputdevicecardname.value || "";

                    // 📌 Depuración: Ver qué ha detectado Volumio
                    self.logger.info(`📢 Estado actualizado de la salida de audio:`);
                    self.logger.info(`🔹 outputDevice: ${outputDevice}`);
                    self.logger.info(`🔹 outputDeviceName: ${outputDeviceName}`);

                    // 🔹 Si el usuario ha cambiado a Headphones o HDMI, NO restauramos asound.conf
                    if (outputDeviceName !== "Pisound") {
                        self.logger.info(`🔄 Se ha seleccionado "${outputDeviceName}". No se restaurará asound.conf.`);
                        return;
                    }

                    // 🔹 Si sigue en Pisound, restauramos la configuración de ALSA
                    self.logger.info("🔄 Se mantiene Pisound. Restaurando configuración de ALSA...");

                    const asoundConfig = `
pcm.!default {
    type             empty
    slave.pcm       "volumio"
}

pcm.volumio {
    type             empty
    slave.pcm       "volumioSoftvol"
}

pcm.volumioSoftvol {
    type softvol
    slave.pcm "volumioOutput"
    control {
        name "Master"
        card "${outputDevice}"
    }
    min_dB -51.0
    max_dB 0.0
}

pcm.volumioOutput {
    type plug
    slave.pcm "volumioHw"
}

pcm.volumioHw {
    type hw
    card "${outputDevice}"
}

ctl.!default {
    type hw
    card "${outputDevice}"
}
                    `;

                    // 📝 Escribir la configuración en asound.conf
                    fs.writeFileSync("/etc/asound.conf", asoundConfig);

                    exec("sudo alsactl restore", (error, stdout, stderr) => {
                        if (error) {
                            self.logger.error(`❌ Error al restaurar ALSA: ${stderr}`);
                        } else {
                            self.logger.info("✅ Configuración de ALSA restaurada correctamente.");
                        }
                    });

                } catch (parseError) {
                    self.logger.error(`❌ Error al parsear config.json: ${parseError}`);
                }
            });
        }
    });
    
};

audiorecorder2.prototype.registerListeners = function() {
    var self = this;

    self.logger.info('Registrando listeners para los botones del plugin.');

    // Listener para el botón "Record"
    self.commandRouter.sharedVars.registerCallback('saveAudio', function() {
        self.logger.info('Botón "Record" presionado.');
        self.saveAudio();
    });

    // Listener para el botón "Stop"
    self.commandRouter.sharedVars.registerCallback('stopAudio', function() {
        self.logger.info('Botón "Stop" presionado.');
        self.stopAudio();
    });

    self.context.coreCommand.sharedVars.registerCallback('overwriteConfirmed', this.overwriteConfirmed.bind(this));
    self.context.coreCommand.sharedVars.registerCallback('overwriteCancelled', this.overwriteCancelled.bind(this));

	self.logger.info('Botones registrados correctamente.');
};

// Configuration Methods -----------------------------------------------------------------------------
/*
audiorecorder2.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
			var filePath = self.config.get('file_path');
            var fileName = self.config.get('file_name');
            

            // Asignar valores a los campos de la interfaz
            uiconf.sections[0].content[0].value = filePath;
            uiconf.sections[0].content[1].value = fileName;
    
            self.logger.info('Configuración de file_path cargada: ' + filePath);
            self.logger.info('Configuración de file_name cargada: ' + fileName);

                // Confirmación de éxito
            self.commandRouter.pushToastMessage('success', 'Configuración Guardada', 'Ruta y nombre de archivo actualizados correctamente.');

            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error('UIConfig.json error'));
        });

    return defer.promise;
};
*/
audiorecorder2.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
            // Asignar valores con alternativa por si devuelven undefined
            uiconf.sections[0].content[0].value = self.config.get('file_path') || '/home/volumio/recordings/';
            uiconf.sections[0].content[1].value = self.config.get('file_name') || 'output.wav';

            // Asignar valores guardados para el efecto MXR (Sección 2)
            uiconf.sections[2].content[0].value = self.config.get('wipper_dis') || 0.5;
            uiconf.sections[2].content[1].value = self.config.get('wipper_out') || 1.0;
            uiconf.sections[2].content[2].value = self.config.get('in_gain') || 0.1;

            defer.resolve(uiconf);
        })
        .fail(function(err)
        {
            self.logger.error('Error al cargar UIConfig: ' + err);
            defer.reject(new Error('UIConfig.json error'));
        });

    return defer.promise;
};

audiorecorder2.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

audiorecorder2.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

audiorecorder2.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

audiorecorder2.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

/*
audiorecorder2.prototype.loadConfig = function() {
    var self = this;

    self.config = new (require('v-conf'))();
    var configFile = self.commandRouter.pluginManager.getConfigurationFile(
        self.context,
        'config.json'
    );
    self.config.loadFile(configFile);
};
*/
// Playback Controls ---------------------------------------------------------------------------------------
// If your plugin is not a music_sevice don't use this part and delete it


audiorecorder2.prototype.addToBrowseSources = function () {
	var self = this;
	// Use this function to add your music service plugin to music sources
    //var data = {name: 'Spotify', uri: 'spotify',plugin_type:'music_service',plugin_name:'spop'};
    var data = {
        name: 'Mis Grabaciones',
        uri: 'audiorecorder2',
        plugin_type: 'music_service',
        plugin_name: 'audiorecorder2'
    };

    self.logger.info('Registrando audiorecorder2 en Browse Sources...');
	self.commandRouter.volumioAddToBrowseSources(data);
	self.logger.info('audiorecorder2 ha sido registrado en Browse Sources...');

};

audiorecorder2.prototype.handleBrowseUri = function (curUri) {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('handleBrowseUri ha sido llamado con: ' + curUri);
    
    if (curUri === 'audiorecorder2') {
        var basePath = self.config.get('file_path');
        var fileList = [];

        // 🔹 Definir los formatos de audio permitidos
        const allowedExtensions = ['.wav', '.mp3', '.flac', '.aac', '.ogg', '.m4a'];
        
        fs.readdir(basePath, (err, files) => {
            if (err) {
                self.logger.error('Error al leer el directorio: ' + err);
                return defer.reject(new Error('No se pueden cargar las grabaciones.'));
            }

            files.forEach(file => {
                //if (file.endsWith('.wav')) {
                // 🔹 Verificar si la extensión del archivo está en la lista permitida
                if (allowedExtensions.some(ext => file.toLowerCase().endsWith(ext))) {
                    fileList.push({
                        service: 'audiorecorder2',
                        type: 'song',
                        title: file,
                        artist: 'Grabación Local',
                        album: 'Mis Grabaciones',
                        icon: 'fa-music', // Asegura que se muestre un icono en la UI
                        uri: 'audiorecorder2/' + file  // URI relativa correcta
                    });
                }
            });

            var response = {
                navigation: {
                    lists: [{
                        title: 'Mis Grabaciones',
                        icon: 'fa-folder',  // Icono de carpeta
                        availableListViews: ['list', 'grid'],
                        items: fileList
                    }],
                    prev: { uri: 'music_service' } // Permite regresar al menú anterior
                }
            };

            self.logger.info('Respuesta de handleBrowseUri: ' + JSON.stringify(response));
            defer.resolve(response);
        });
    } else {
        defer.reject(new Error('URI no soportada: ' + curUri));
    }

    return defer.promise;
};

//Define a method to obtain track duration from track metadata
audiorecorder2.prototype.getTrackDuration = async function (filePath) {
    try {
        const metadata = await mm.parseFile(filePath);
        const duration = metadata.format.duration; // Duración en segundos

        if (duration) {
            this.logger.info(`Duración de la pista obtenida: ${duration} segundos.`);
            return duration;
        } else {
            this.logger.warn('No se pudo obtener la duración de la pista.');
            return 0;
        }
    } catch (error) {
        this.logger.error('Error obteniendo duración de la pista: ' + error);
        return 0;
    }
};

// Define a method to clear, add, and play an array of tracks

audiorecorder2.prototype.clearAddPlayTrack = async function(track) {
	var self = this;
	//self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'audiorecorder2::clearAddPlayTrack');

	self.commandRouter.logger.info('clearAddPlayTrack ha sido llamado con: ' + JSON.stringify(track));

    if (!track || !track.uri) {
        self.logger.error('Error: La pista no tiene una URI válida.');
        return defer.reject(new Error('La pista no tiene una URI válida.'));
    }

    var filePath = track.uri.replace('file://', ''); // Convertimos la URI a una ruta válida

    self.logger.info('Obteniendo duración de la pista antes de reproducir.');

    self.trackDuration = await self.getTrackDuration(filePath);
    self.currentSeek = 0;  // Reiniciar el tiempo actual de reproducción

    var trackData = {
        service: 'audiorecorder2',
        type: 'track',
        title: track.title,
        artist: 'Grabación Local',
        album: 'Mis Grabaciones',
        uri: track.uri
    };

    self.logger.info('Añadiendo pista a la cola y reproduciendo: ' + JSON.stringify(trackData));

    // Limpiar la cola, agregar la pista y reproducir
    self.commandRouter.executeOnPlugin('music_service', 'mpd', 'clearAddPlayTrack', trackData)
        .then(() => {
            self.logger.info('Reproducción iniciada.');
            self.state = 'play';  // 🔹 Asegurar que el estado se actualiza correctamente
            self.startSeekUpdater();  // 🔹 Iniciar contador de progreso
            self.pushState();  // 🔹 Notificar a Volumio para que cambie el icono en la barra inferior
            //defer.resolve();
        })
        .fail((err) => {
            self.logger.error('Error en clearAddPlayTrack: ' + err);
            //defer.reject(err);
        });

    //return defer.promise;
	
	//return self.sendSpopCommand('uplay', [track.uri]);
};

audiorecorder2.prototype.pause = function () {
    var self = this;

    self.logger.info('pause ha sido llamado.');

    self.commandRouter.executeOnPlugin('music_service', 'mpd', 'pause', [])
        .then(() => {
            self.logger.info('Reproducción pausada.');
            self.state = 'pause';  // 🔹 Actualizamos el estado

            if (self.seekInterval) {
                clearInterval(self.seekInterval); // Detiene el progreso con la pausa
            }

            self.pushState();  // 🔹 Notificamos a Volumio
        })
        .fail((err) => {
            self.logger.error('Error al intentar pausar: ' + err);
        });
};

audiorecorder2.prototype.resume = function () {
    var self = this;

    self.logger.info('resume ha sido llamado.');

    self.commandRouter.executeOnPlugin('music_service', 'mpd', 'resume', [])
        .then(() => {
            self.logger.info('Reproducción reanudada.');
            self.state = 'play';  // 🔹 Cambiamos el estado a 'play'

            self.startSeekUpdater();  // 🔹 Volver a actualizar la barra de progreso

            self.pushState();  // 🔹 Notificamos a Volumio
        })
        .fail((err) => {
            self.logger.error('Error al intentar reanudar la pista: ' + err);
        });
};

audiorecorder2.prototype.setVolume = function (volume) {
    var self = this;
    
    self.logger.info(`🔊 Ajustando volumen a: ${volume}%`);

    // 🔹 Usar `amixer` para cambiar el volumen en ALSA
    exec(`amixer set Master ${volume}%`, (error, stdout, stderr) => {
        if (error) {
            self.logger.error(`❌ Error al ajustar el volumen: ${stderr}`);
        } else {
            self.logger.info(`✅ Volumen ajustado a ${volume}%`);
        }
    });
};

audiorecorder2.prototype.getVolume = function () {
    var self = this;
    var defer = libQ.defer();

    exec("amixer get Master | grep -o '[0-9]*%' | head -1", (error, stdout, stderr) => {
        if (error) {
            self.logger.error(`❌ Error al obtener el volumen: ${stderr}`);
            defer.reject(error);
        } else {
            let volume = parseInt(stdout.replace('%', '').trim(), 10);
            self.logger.info(`🔊 Volumen actual: ${volume}%`);
            defer.resolve(volume);
        }
    });

    return defer.promise;
};

audiorecorder2.prototype.saveConfig = function (data) {
    var self = this;
    
    self.logger.info('saveConfig ha sido llamado');

    self.config.set('file_path', data['file_path']);
    self.config.set('file_name', data['file_name']);

    self.logger.info('Configuración guardada: ' + JSON.stringify(data));

    self.commandRouter.pushToastMessage('success', 'Configuración Guardada', 'Los cambios han sido aplicados.');
};

audiorecorder2.prototype.saveAudio = function() {
    var self = this;

    self.logger.info('saveAudio ha sido llamado.');

    // Si ya hay una grabación en marcha, no hace nada
    if (self.state === "recording") {
        self.logger.warn('Ya se está grabando una pista.');
        return;
    }

    if (self.state === "play" || self.state === "pause") {
        self.logger.warn('No se puede grabar porque hay pista en reproducción.');
        self.commandRouter.pushToastMessage('warning', 'Play', 'Pista en reproducción.');
        return;
    }

    //var fullPath = this.filePath + this.fileName;
    const fullPath = self.config.get('file_path') + self.config.get('file_name');

    self.logger.info('Iniciando grabación de audio: ' + fullPath);

    // Verificar si el archivo ya existe
    if (fs.existsSync(fullPath)) {
        self.logger.warn('El archivo ya existe: ' + fullPath);
        self.confirmOverwrite(fullPath);
        return;
    }

    self.startRecording(fullPath);
 
};

audiorecorder2.prototype.confirmOverwrite = function(fullPath) {
    var self = this;

    // Mostrar un mensaje de confirmación en la interfaz
    self.commandRouter.broadcastMessage('openModal', {
        title: 'Archivo ya existente',
        message: `El archivo ${fullPath} ya existe. ¿Quieres sobrescribirlo?`,
        size: 'lg',
        buttons: [
            {
                name: 'Sobrescribir',
                class: 'btn btn-info',
                emit: 'callMethod',
                payload: {
                    'endpoint': 'system_controller/audiorecorder',
                    'method': 'overwriteConfirmed', 
                    'data': `${fullPath}`
                }
            },
            {
                name: 'Cancelar',
                class: 'btn btn-info',
                emit: 'callMethod',
                payload: {
                    'endpoint': 'system_controller/audiorecorder',
                    'method': 'overwriteCancelled'
                }
            }
        ]
    });
};


audiorecorder2.prototype.overwriteConfirmed = function (fullPath){
    var self = this;
    self.logger.info('El usuario confirmó sobrescribir: ' + fullPath);
    self.startRecording(fullPath);

};

audiorecorder2.prototype.overwriteCancelled = function (){
    var self = this;
    self.logger.info('El usuario canceló la grabación.');
    self.commandRouter.pushToastMessage('info', 'Grabación Cancelada', 'La grabación ha sido cancelada.');

};

audiorecorder2.prototype.startRecording = function(fullPath) {
    var self = this;

    self.logger.info('Iniciando grabación de audio...');

    // Configurar la ruta completa del archivo
    //var fullPath = self.filePath + self.fileName;

    // Verificar si ya hay un proceso de grabación activo
    if (self.recordProcess) {
        self.logger.warn('Ya hay una grabación activa.');
        return;
    }

    const { spawn } = require('child_process');
    self.recordProcess = spawn('arecord', [
        '-D',
        'plughw:2,0',
        '-f',
        'cd',
        '-t',
        'wav',
        '-c',
        '2',
        '-r',
        '48000',
        fullPath
    ]);

    self.state = 'recording';
    /*
    self.recordProcess.stderr.on('data', (data) => {
        self.logger.info('Grabación: ' + data.toString());
    });

    self.recordProcess.on('close', (code) => {
        self.logger.info('Grabación finalizada.');
        self.recordProcess = null;
        self.state = 'stop';
    });
    */

    // Manejar errores de grabación

    self.recorProcees.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (message.includes('Recording WAVE')) {
            // Mensaje informativo sobre la grabación
            self.logger.info('Información de arecord: ' + message);
        } else if (message.includes('Aborted by signal Terminated')) {
            // Mensaje esperado al detener la grabación
            self.logger.info('Grabación detenida por el usuario: ' + message);
        } else {
            // Otros mensajes se registran como errores
            self.logger.error('Error en la grabación: ' + message);
        }
    });

    // Manejar el cierre del proceso (close event)
    self.recordProcess.on('close', (code, signal) => {
        if (signal === 'SIGTERM' || code === 1) {
            self.logger.info('Grabación detenida manualmente por el usuario.');
        } else if (code !== 0) {
            self.logger.error('La grabación se cerró con código: ' + code);
        } else {
            self.logger.info('Grabación completada correctamente.');
        }
        self.state = "idle";
        self.recordProcess = null;
    });

    // Manejar errores críticos del proceso (error event)
    self.recordProcess.on('error', (err) => {
        self.logger.error('Error crítico en la grabación: ' + err.message);
        self.commandRouter.pushToastMessage('error', 'Grabación', 'Error crítico en la grabación.');
        self.state = "idle";
        self.recordProcess = null
    });
};

audiorecorder2.prototype.stopAudio = function() {
    var self = this;

    if (self.state === 'recording' && self.recordProcess) {
        self.logger.info('Deteniendo grabación...');
        self.recordProcess.kill('SIGTERM');
        self.state = 'stop';
        self.pushState();
        return;
    } else if (self.state !== 'stop')  {
        self.logger.info('Deteniendo reproducción...');
        
         // 🔹 1. Detener completamente la reproducción
        self.commandRouter.volumioStop();

        self.logger.info('Reproducción detenida.');

        // 🔹 2. Limpiar la cola antes de actualizar el estado
        self.commandRouter.executeOnPlugin('music_service', 'mpd', 'clear', [])
            .then(() => {
                self.logger.info('Cola limpiada.');
                

                 // 🔹 3. Reiniciar el progreso de reproducción
                 
                 if (self.seekInterval) {
                    clearInterval(self.seekInterval);
                }
                self.currentSeek = 0;
                self.trackDuration = 0;
                self.state = 'stop';

            // 4. Notificar a Volumio que el estado es "stop" sin activar la reproducción de la siguiente pista
                return self.pushState();
            })
            .then(() => {
                self.logger.info('Estado de stop enviado correctamente.');
            })
            .fail((err) => {
                self.logger.error('Error al detener la reproducción: ' + err);
            });
    }
};

audiorecorder2.prototype.seek = function (position) {
    var self = this;

    self.logger.info(`Seek solicitado: ${position} s`);

    if (self.state !== 'play' && self.state !== 'pause') {
        self.logger.warn(' No se puede hacer seek: No hay pista en reproducción.');
        return;
    }

    //var seekInSeconds = Math.floor(position / 1000);  // Convertir ms a segundos

    //self.logger.info(`Moviendo reproducción a: ${seekInSeconds} segundos`);

    self.logger.info(`🔎 Estado actual: ${self.state}, Seek actual: ${self.currentSeek}, Duración: ${self.trackDuration}`);

    
    // 🔹 Usar MPD para posicionar la reproducción en la pista actual
    self.commandRouter.executeOnPlugin('music_service', 'mpd', 'seek', [position])
        .then(() => {
            self.logger.info('Seek completado.');
            self.currentSeek = position;
            self.pushState();  // 🔹 Enviar actualización a Volumio
        })
        .fail((err) => {
            self.logger.error('Error al hacer seek: ' + err);
        });
};

// Stop
audiorecorder2.prototype.stop = function() {
    var self = this;
    self.logger.info('Método stop() ha sido llamado por Volumio.');

    var defer = libQ.defer();

    // 🔹 Detener la reproducción si está en curso
    if (self.state === 'play') {
        self.logger.info('Deteniendo reproducción antes de saltar de pista...');
        self.commandRouter.executeOnPlugin('music_service', 'mpd', 'stop', [])
            .then(() => {
                self.logger.info('Reproducción detenida.');
                self.state = 'stop';
                self.currentSeek = 0; // 🔹 Reiniciar el contador de reproducción
                self.pushState(); // 🔹 Notificar a Volumio que la pista se detuvo
                defer.resolve();
            })
            .fail((err) => {
                self.logger.error('Error al detener la pista en stop(): ' + err);
                defer.reject(err);
            });
    } else {
        self.logger.info('No hay pista en reproducción, detención no necesaria.');
        defer.resolve();
    }

    return defer.promise;
};
/*

// Get state
audiorecorder2.prototype.getState = function() {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'audiorecorder2::getState');


};

//Parse state
audiorecorder2.prototype.parseState = function(sState) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'audiorecorder2::parseState');

	//Use this method to parse the state and eventually send it with the following function
};
*/
// Announce updated State
audiorecorder2.prototype.pushState = function() {
	var self = this;

    self.logger.info('Pushstate ha sido llamado');
	
    const state = {
        status: self.recordProcess ? 'recording' : self.state,  // 🔹 Estado correcto
        service: 'audiorecorder2',
        title: self.currentTrack ? self.currentTrack.title : self.config.get('file_name'),
        artist: 'Grabación Local',
        album: 'Mis Grabaciones',
        trackType: 'wav',
        uri: self.currentTrack ? self.currentTrack.uri : '',
        duration: self.trackDuration || 0,  // Duración total de la pista en segundos
        seek: self.currentSeek || 0  // Posición actual en la pista en milisegundos
    };

    self.logger.info('Enviando estado actualizado a Volumio: ' + JSON.stringify(state));
	return self.commandRouter.servicePushState(state, 'audiorecorder2');
};

audiorecorder2.prototype.startSeekUpdater = function () {
    var self = this;

    if (self.seekInterval) {
        clearInterval(self.seekInterval);
    }

    self.seekInterval = setInterval(() => {
        if (self.state === 'play' && self.currentSeek < (self.trackDuration * 1000)) {
            self.currentSeek += 2000;  // Aumentar 2 segundos en milisegundos
            self.pushState();  // Actualizar barra de progreso en Volumio
        } else {
            clearInterval(self.seekInterval);
            if (self.currentSeek >= (self.trackDuration * 1000)) {
                self.logger.info('La pista ha finalizado. Cambiando estado a stop.');
                self.state = 'stop';
                self.pushState();  // 🔹 Notificar a Volumio que la pista ha terminado

                // 🔹 Asegurar que Volumio cambia visualmente el botón
                //self.commandRouter.volumioStop();
            }
        }
    }, 2000);
};

audiorecorder2.prototype.explodeUri = function(uri) {
	var self = this;
	var defer=libQ.defer();

	self.logger.info('explodeUri ha sido llamado con: ' + uri);

    // Extraer el nombre del archivo de la URI relativa
    var fileName = uri.replace('audiorecorder2/', '');
    var basePath = self.config.get('file_path');
    var fullPath = basePath + fileName;  // Reconstruir la ruta completa del archivo

    // 🔹 Extraer extensión del archivo
    var trackType = fileName.split('.').pop().toLowerCase();  // Detectar formato (wav, mp3, etc.)

    var track = {
        service: 'audiorecorder2',
        type: 'track',
        title: fileName,
        artist: 'Grabación Local',
        album: 'Mis Grabaciones',
        uri: 'file://' + fullPath,  //  Importante: Usar el esquema 'file://'
        trackType: trackType // Guardar correctamente el tipo de archivo
    };

    self.logger.info('Pista generada en explodeUri: ' + JSON.stringify(track));

    defer.resolve([track]);

	return defer.promise;
};

/*
audiorecorder2.prototype.getAlbumArt = function (data, path) {

	var artist, album;

	if (data != undefined && data.path != undefined) {
		path = data.path;
	}

	var web;

	if (data != undefined && data.artist != undefined) {
		artist = data.artist;
		if (data.album != undefined)
			album = data.album;
		else album = data.artist;

		web = '?web=' + nodetools.urlEncode(artist) + '/' + nodetools.urlEncode(album) + '/large'
	}

	var url = '/albumart';

	if (web != undefined)
		url = url + web;

	if (web != undefined && path != undefined)
		url = url + '&';
	else if (path != undefined)
		url = url + '?';

	if (path != undefined)
		url = url + 'path=' + nodetools.urlEncode(path);

	return url;
};





audiorecorder2.prototype.search = function (query) {
	var self=this;
	var defer=libQ.defer();

	// Mandatory, search. You can divide the search in sections using following functions

	return defer.promise;
};

audiorecorder2.prototype._searchArtists = function (results) {

};

audiorecorder2.prototype._searchAlbums = function (results) {

};

audiorecorder2.prototype._searchPlaylists = function (results) {


};

audiorecorder2.prototype._searchTracks = function (results) {

};

audiorecorder2.prototype.goto=function(data){
    var self=this
    var defer=libQ.defer()

// Handle go to artist and go to album function

     return defer.promise;
};
*/

audiorecorder2.prototype.saveMxrConfig = function (data) {
    var self = this;

    var toNum = function (v, def, min, max) {
        var n = parseFloat(v);
        if (isNaN(n)) return def;
        return Math.min(max, Math.max(min, n));
    };

    var dis  = toNum(data['wipper_dis'], 0.5, 0.0,  1.0);
    var out  = toNum(data['wipper_out'], 1.0, 0.0,  1.0);
    var gain = toNum(data['in_gain'],    0.1, 0.01, 1.0);

    self.config.set('wipper_dis', dis);
    self.config.set('wipper_out', out);
    self.config.set('in_gain', gain);

    self.logger.info('MXR: parametros guardados dis=' + dis + ' out=' + out + ' gain=' + gain);
    self.commandRouter.pushToastMessage('success', 'MXR Distortion', 'Parametros guardados.');

    return libQ.resolve();
};

// Procesa la ultima grabacion con el modelo DSP en Python
audiorecorder2.prototype.applyMxrEffect = function () {
    var self = this;

    var basePath   = self.config.get('file_path') || '/home/volumio/recordings/';
    var fileName   = self.config.get('file_name') || 'output.wav';
    var inputFile  = path.join(basePath, fileName);
    var outputFile = path.join(basePath, 'mxr_' + fileName);
    var scriptPath = path.join(__dirname, 'file_proc.py');

    var dis  = parseFloat(self.config.get('wipper_dis'));
    var out  = parseFloat(self.config.get('wipper_out'));
    var gain = parseFloat(self.config.get('in_gain'));
    if (isNaN(dis))  dis  = 0.5;
    if (isNaN(out))  out  = 1.0;
    if (isNaN(gain)) gain = 0.1;

    if (!fs.existsSync(scriptPath)) {
        self.logger.error('MXR: no existe ' + scriptPath);
        self.commandRouter.pushToastMessage('error', 'MXR', 'Falta file_proc.py en el plugin.');
        return libQ.resolve();
    }
    if (!fs.existsSync(inputFile)) {
        self.logger.error('MXR: no existe ' + inputFile);
        self.commandRouter.pushToastMessage('error', 'MXR', 'No se encuentra: ' + fileName);
        return libQ.resolve();
    }

    var cmd = '/usr/bin/python3 -u "' + scriptPath + '"'
            + ' "' + inputFile + '"'
            + ' "' + outputFile + '"'
            + ' ' + dis + ' ' + out
            + ' --in-gain ' + gain;

    self.logger.info('MXR: ejecutando -> ' + cmd);
    self.commandRouter.pushToastMessage('info', 'MXR Distortion', 'Procesando audio, espera...');

    exec(cmd, { cwd: __dirname, maxBuffer: 10 * 1024 * 1024, timeout: 900000 },
        function (error, stdout, stderr) {
            if (error) {
                var msg = (stderr || error.message || '').toString().trim();
                self.logger.error('MXR: fallo (code ' + error.code + '): ' + msg);
                self.commandRouter.pushToastMessage('error', 'MXR Distortion', msg.slice(0, 150) || 'Error al procesar.');
                return;
            }
            self.logger.info('MXR: OK\n' + stdout);
            self.commandRouter.pushToastMessage('success', 'MXR Distortion', 'Listo: mxr_' + fileName);
            self.commandRouter.refreshBrowseSources();
        });

    return libQ.resolve();
};