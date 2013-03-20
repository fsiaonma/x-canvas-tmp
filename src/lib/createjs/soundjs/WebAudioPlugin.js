xc.module.define("xc.createjs.WebAudioPlugin", function(exports) {

    var Sound = xc.module.require("xc.createjs.Sound");
    var SoundInstance = xc.module.require("xc.createjs.SoundInstance");

    /**
     * WebAudioPlugin's SoundInstance implementation.
     */
    var WebAudioSoundInstance = SoundInstance.extend({
        initialize: function(src, owner) {
            this.owner = owner;
            this.src = src;
            this.panNode = this.owner.context.createPanner(); // allows us to manipulate left and right audio  // TODO test how this affects when we have mono audio
            this.gainNode = this.owner.context.createGainNode(); // allows us to manipulate instance volume
            this.gainNode.connect(this.panNode); // connect us to our sequence that leads to context.destination
            if (this.owner.isPreloadComplete(this.src)) {
                this.duration = this.owner.arrayBuffers[this.src].duration * 1000;
            }
            this.endedHandler = Sound.proxy(this.handleSoundComplete, this);
            this.readyHandler = Sound.proxy(this.handleSoundReady, this);
            this.stalledHandler = Sound.proxy(this.handleSoundStalled, this);
        },

        soundCompleteTimeout: null,

        startTime: 0,

        /**
         * 清除实例。移除引用以及清除所有的额外参数。例如 timers。
         * 
         * @method cleanup
         * @protected
         */
        cleanUp: function() {
            // if playbackState is UNSCHEDULED_STATE, then noteON or noteGrainOn has not been called so calling noteOff would throw an error
            if (this.sourceNode && this.sourceNode.playbackState != this.sourceNode.UNSCHEDULED_STATE) {
                this.sourceNode.noteOff(0);
                this.sourceNode = null; // release reference so Web Audio can handle removing references and garbage collection
            }
            if (this.panNode.numberOfOutputs != 0) {
                this.panNode.disconnect(0);
            } // this works because we only have one connection, and it returns 0 if we've already disconnected it.
            clearTimeout(this.delayTimeoutId); // clear timeout that plays delayed sound
            clearTimeout(this.soundCompleteTimeout); // clear timeout that triggers sound complete
            Sound.playFinished(this);
        },

        // 播放已止步不前，因此失败。
        handleSoundStalled: function(event) {
            this.sendEvent("failed");
        },

        // 声音已经准备好播放。
        handleSoundReady: function(event) {
            if (this.offset > this.getDuration()) {
                this.playFailed();
                return;
            } else if (this.offset < 0) { // may not need this check if noteGrainOn ignores negative values, this is not specified in the API http://www.w3.org/TR/webaudio/#AudioBufferSourceNode
                this.offset = 0;
            }
            this.playState = Sound.PLAY_SUCCEEDED;
            this.paused = false;
            this.panNode.connect(this.owner.gainNode); // this line can cause a memory leak.  Nodes need to be disconnected from the audioDestination or any sequence that leads to it.
            // WebAudio supports BufferSource, MediaElementSource, and MediaStreamSource.
            // NOTE MediaElementSource requires different commands to play, pause, and stop because it uses audio tags.
            // The same is assumed for MediaStreamSource, although it may share the same commands as MediaElementSource.
            this.sourceNode = this.owner.context.createBufferSource();
            this.sourceNode.buffer = this.owner.arrayBuffers[this.src];
            this.duration = this.owner.arrayBuffers[this.src].duration * 1000;
            this.sourceNode.connect(this.gainNode);
            this.soundCompleteTimeout = setTimeout(this.endedHandler, (this.sourceNode.buffer.duration - this.offset) * 1000); // NOTE *1000 because WebAudio reports everything in seconds but js uses milliseconds
            this.startTime = this.owner.context.currentTime - this.offset;
            this.sourceNode.noteGrainOn(0, this.offset, this.sourceNode.buffer.duration - this.offset);
        },

        // 音频完成播放。如果有需要，手动循环。
        // 提供给 WebAudioPlugin 的 soundCompleteTimeout 内部调用。
        handleSoundComplete: function(event) {
            this.offset = 0; // have to set this as it can be set by pause during playback
            if (this.remainingLoops != 0) {
                this.remainingLoops--; // NOTE this introduces a theoretical limit on loops = float max size x 2 - 1
                this.handleSoundReady(null);
                if (this.onLoop != null) {
                    this.onLoop(this);
                }
                this.sendEvent("loop");
                return;
            }
            this.playState = Sound.PLAY_FINISHED;
            if (this.onComplete != null) {
                this.onComplete(this);
            }
            this.sendEvent("complete");
            this.cleanUp();
        },

        beginPlaying: function(offset, loop, volume, pan) {
            if (!this.src) {
                return;
            }
            this.offset = offset / 1000; //convert ms to sec
            this.remainingLoops = loop;
            this.setVolume(volume);
            this.setPan(pan);
            if (this.owner.isPreloadComplete(this.src)) {
                this.handleSoundReady(null);
                this.onPlaySucceeded && this.onPlaySucceeded(this);
                this.sendEvent("succeeded");
                return 1;
            } else {
                this.playFailed();
                return;
            }
        },

        pause: function() {
            if (!this.paused && this.playState == Sound.PLAY_SUCCEEDED) {
                this.paused = true;
                this.offset = this.owner.context.currentTime - this.startTime; // this allows us to restart the sound at the same point in playback
                this.sourceNode.noteOff(0); // note this means the sourceNode cannot be reused and must be recreated
                if (this.panNode.numberOfOutputs != 0) {
                    this.panNode.disconnect();
                } // this works because we only have one connection, and it returns 0 if we've already disconnected it.
                clearTimeout(this.delayTimeoutId); // clear timeout that plays delayed sound
                clearTimeout(this.soundCompleteTimeout); // clear timeout that triggers sound complete
                return true;
            }
            return false;
        },

        resume: function() {
            if (!this.paused) {
                return false;
            }
            this.handleSoundReady(null);
            return true;
        },

        stop: function() {
            this.playState = Sound.PLAY_FINISHED;
            this.cleanUp();
            this.offset = 0; // set audio to start at the beginning
            return true;
        },

        setVolume: function(value) {
            if (Number(value) == null) {
                return false;
            }
            value = Math.max(0, Math.min(1, value));
            this.volume = value;
            this.updateVolume();
            return true; // This is always true because even if the volume is not updated, the value is set
        },

        updateVolume: function() {
            var newVolume = this.muted ? 0 : this.volume;
            if (newVolume != this.gainNode.gain.value) {
                this.gainNode.gain.value = newVolume;
                return true;
            }
            return false;
        },

        setMute: function(value) {
            if (value == null || value == undefined) {
                return false
            }
            this.muted = value;
            this.updateVolume();
            return true;
        },

        setPan: function(value) {
            if (this.owner.capabilities.panning) {
                // Note that panning in WebAudioPlugin can support 3D audio, but our implementation does not.
                this.panNode.setPosition(value, 0, -0.5); // z need to be -0.5 otherwise the sound only plays in left, right, or center
                this.pan = value; // Unfortunately panner does not give us a way to access this after it is set http://www.w3.org/TR/webaudio/#AudioPannerNode
            } else {
                return false;
            }
        },

        getPosition: function() {
            if (this.paused || this.sourceNode == null) {
                var pos = this.offset;
            } else {
                var pos = this.owner.context.currentTime - this.startTime;
            }
            return pos * 1000; // pos in seconds * 1000 to give milliseconds
        },

        setPosition: function(value) {
            this.offset = value / 1000; // convert milliseconds to seconds
            if (this.sourceNode && this.sourceNode.playbackState != this.sourceNode.UNSCHEDULED_STATE) { // if playbackState is UNSCHEDULED_STATE, then noteON or noteGrainOn has not been called so calling noteOff would throw an error
                this.sourceNode.noteOff(0); // we need to stop this sound from continuing to play, as we need to recreate the sourceNode to change position
                clearTimeout(this.soundCompleteTimeout); // clear timeout that triggers sound complete
            } // NOTE we cannot just call cleanup because it also calls the Sound function playFinished which releases this instance in SoundChannel
            if (!this.paused && this.playState == Sound.PLAY_SUCCEEDED) {
                this.handleSoundReady(null);
            }
            return true;
        },

        toString: function() {
            return "[WebAudioPlugin SoundInstance]";
        }
    });

    /**
     * 一个内部辅助类，用于帮助 web audio 通过 XHR，预加载。
     * 注：这个类和它的方法没有适当的说明是为了避免长生 HTML 文档。
     * 
     * @class WebAudioLoader
     * @param {String} src 要加载的音频资源。
     * @param {Object} owner 创建当前实例的类的引用。
     * @constructor
     */
    var WebAudioLoader = xc.class.create({
        initialize: function(src, owner) {
            this.src = src;
            this.owner = owner;
        },

        // XHR2 请求的请求对象。
        request: null,

        owner: null,

        progress: -1,

        /**
         * 要加载的音频资源。当我们返回这个类的时候用于回调函数。
         * 
         * @property src
         * @type {String}
         */
        src: null,

        /**
         * 加载完成时的返回的解压后的 AudioBuffer。
         * 
         * @property result
         * @type {AudioBuffer}
         * @protected
         */
        result: null,

        /**
         * 当加载完成的时候触发该回调。这个紧接 HTML 标签命名。
         * 
         * @property onload
         * @type {Method}
         */
        onload: null,

        /**
         * 当加载进度向前的时候触发。这个跟着 HTML 标签命名
         * 
         * @property onprogress
         * @type {Method}
         */
        onprogress: null,

        /**
         * 当加载出现错误的时候触发该回调。
         * 
         * @property onError
         * @type {Method}
         * @protected
         */
        onError: null,

        /**
         * 开始加载内容。
         * 
         * @method load
         * @param {String} src 音频的资源路径。
         */
        load: function(src) {
            if (src != null) {
                this.src = src;
            }
            this.request = new XMLHttpRequest();
            this.request.open("GET", this.src, true);
            this.request.responseType = "arraybuffer";
            this.request.onload = Sound.proxy(this.handleLoad, this);
            this.request.onError = Sound.proxy(this.handleError, this);
            this.request.onprogress = Sound.proxy(this.handleProgress, this);
            this.request.send();
        },

        /**
         * 一个汇报进度的加载器。
         * 
         * @method handleProgress
         * @param {Number} loaded 加载数。
         * @param {Number} total 总数。
         * @private
         */
        handleProgress: function(loaded, total) {
            this.progress = loaded / total;
            if (this.onprogress == null) {
                return;
            }
            this.onprogress({
                loaded: loaded,
                total: total,
                progress: this.progress
            });
        },

        /**
         * 音频完成了加载。
         * 
         * @method handleLoad
         * @protected
         */
        handleLoad: function() {
            WebAudioPlugin.context.decodeAudioData(this.request.response, Sound.proxy(this.handleAudioDecoded, this), Sound.proxy(this.handleError, this));
        },

        /**
         * 音频被解码。
         * 
         * @method handleAudioDecoded
         * @protected
         */
        handleAudioDecoded: function(decodedAudio) {
            this.progress = 1;
            this.result = decodedAudio;
            this.owner.addPreloadResults(this.src, this.result);
            this.onload && this.onload();
        },

        /**
         * 加载器导致的错误。
         * 
         * @method handleError
         * @protected
         */
        handleError: function(evt) {
            this.owner.removeFromPreload(this.src);
            this.onerror && this.onerror(evt);
        },

        toString: function() {
            return "[WebAudioPlugin WebAudioLoader]";
        }
    });

    /**
     * 通过 Web Audio 在浏览器播放音频。WebAudio 插件已经成功通过以下测试：
     * <ul><li>Google Chrome, version 23+ on OS X and Windows</li>
     *      <li>Safari 6+ on OS X</li>
     *      <li>Mobile Safari on iOS 6+</li>
     * </ul>
     * 
     * WebAudioPlugin 是当前的默认默认插件。以及会在任何支持它的情况下用到它。要修噶它的优先级的话，
     * 请查阅 Sound API 的 {{#crossLink "Sound/registerPlugins"}}{{/crossLink}} 方法。
     *
     * <h4>已知 Web Audio 插件浏览器和操作系统的问题</h4>
     * <b>Webkit (Chrome 和 Safari)</b><br />
     * <ul><li>AudioNode.disconnect 不是每次都有效。这个可能取决于文件的大小。</li>
     *
     * <b>iOS 6 局限性</b><br />
     * <ul><li>Sound 在用户事件里面不能静音 (touch)。</li>
     *
     * @class WebAudioPlugin
     * @constructor
     */
    var WebAudioPlugin = xc.class.create({
        initialize: function() {
            this.capabilities = WebAudioPlugin.capabilities;
            this.arrayBuffers = {};
            this.context = WebAudioPlugin.context;
            this.gainNode = WebAudioPlugin.gainNode;
            this.dynamicsCompressorNode = WebAudioPlugin.dynamicsCompressorNode;
        },

        capabilities: null, // doc'd above

        /**
         * web audio context，用于播放音频。所有 WebAudioPlugin 的节点都必须在 context 内。
         * 
         * @property context
         * @type {AudioContext}
         */
        context: null,

        /**
         * 一个 DynamicsCompressorNode，用于改善声音以及防止声音失真（http://www.w3.org/TR/webaudio/#DynamicsCompressorNode）。
         * 链接到 <code>context.destination</code>。
         * 
         * @property dynamicsCompressorNode
         * @type {AudioNode}
         */
        dynamicsCompressorNode: null,

        /**
         * 一个用于控制主音量 GainNode。链接到 <code>dynamicsCompressorNode</code>。
         * 
         * @property gainNode
         * @type {AudioGainNode}
         */
        gainNode: null,

        /** 
         * 一个内部使用的 ArrayBuffers 哈希集合，以资源的 URI 作为索引。这个用于防止多次加载或解析音频。
         * 如果文件已经开始加载，<code>arrayBuffers[src]</code> 会设置为 true。一旦加载完成，则设置一个加载完成的 ArrayBuffer 实例。
         * 
         * @property arrayBuffers
         * @type {Object}
         * @protected
         */
        arrayBuffers: null,

        /**
         * 为音频的预加载和安装进行预注册。这个通过 {{#crossLink "Sound"}}{{/crossLink}} 调用。
         * 注意 WebAudio 提供了一个 <code>WebAudioLoader</code> 实例，该实例可以协助 <a href="http://preloadjs.com">PreloadJS</a> 去预加载。
         * 
         * @method register
         * @param {String} src 音频的资源路径
         * @param {Number} instances 正在播放的音频实例允许 channel 的数量。请注意，WebAudioPlugin 不管理此优先级。
         * @return {Object} 一个包含预加载标签的对象。
         */
        register: function(src, instances) {
            this.arrayBuffers[src] = true; // This is needed for PreloadJS
            var tag = new WebAudioLoader(src, this);
            return {
                tag: tag
            };
        },

        /**
         * 检测是否已经开始预加载。
         * 
         * @method isPreloadStarted
         * @param {String} src 要检查的资源 URI。
         * @return {Boolean} 如果已经开始预加载，则返回 true。
         */
        isPreloadStarted: function(src) {
            return (this.arrayBuffers[src] != null);
        },

        /**
         * 检查是否已经对指定资源完成预加载，如果资源已经定义 （但不 === true），那么就加载完成了。
         * 
         * @method isPreloadComplete
         * @param {String} src 要加载音频的 URI。
         * @return {Boolean}
         */
        isPreloadComplete: function(src) {
            return (!(this.arrayBuffers[src] == null || this.arrayBuffers[src] == true));
        },

        /**
         * 从预加载列表里移除一个资源。注意这个不会停止预加载。
         * 
         * @method removeFromPreload
         * @param {String} src 要加载音频的 URI。
         * @return {Boolean}
         */
        removeFromPreload: function(src) {
            delete (this.arrayBuffers[src]);
        },

        /**
         * 将结果加载到预加载哈希集合。
         * 
         * @method addPreloadResults
         * @param {String} src 要卸载声音的 URI。
         * @return {Boolean}
         */
        addPreloadResults: function(src, result) {
            this.arrayBuffers[src] = result;
        },

        /**
         * 处理内部预加载完成。
         * 
         * @method handlePreloadComplete
         * @private
         */
        handlePreloadComplete: function() {
            Sound.sendLoadComplete(this.src); // fire event or callback on Sound
        },

        /**
         * 内部预加载音频。利用 XHR2 加载 array buffer 格式的音频给 WebAudio 用。
         * 
         * @method preload
         * @param {String} src 要加载的音频的 URI。
         * @param {Object} instance 不在插件内使用。
         * @protected
         */
        preload: function(src, instance) {
            this.arrayBuffers[src] = true;
            var loader = new WebAudioLoader(src, this);
            loader.onload = this.handlePreloadComplete;
            loader.load();
        },

        /**
         * 创建一个音频实例。如果音频是没有预加载的，则会在这里进行内部加载。
         * 
         * @method create
         * @param {String} src 要加载的音频的 URI。
         * @return {SoundInstance} 一个用于播放和可以控制的音频实例。
         */
        create: function(src) {
            if (!this.isPreloadStarted(src)) {
                this.preload(src);
            }
            return new WebAudioSoundInstance(src, this);
        },

        toString: function() {
            return "[WebAudioPlugin]";
        }
    });

    /**
     * 插件的能力。这个通过 <code>"WebAudioPlugin/generateCapabilities</code> 创建。
     * 
     * @property capabilities
     * @type {Object}
     * @default null
     * @static
     */
    WebAudioPlugin.capabilities = null;

    /**
     * 判断插件能否在当前的 浏览器/操作系统 使用。
     * 
     * @method isSupported
     * @return {Boolean} 如果插件能被初始化，返回 true。
     * @static
     */
    WebAudioPlugin.isSupported = function() {
        if (location.protocol == "file:") {
            return false;
        } // Web Audio requires XHR, which is not available locally
        WebAudioPlugin.generateCapabilities();
        if (WebAudioPlugin.context == null) {
            return false;
        }
        return true;
    };

    /**
     * 决定插件的能力。内部使用，请看 Sound API 的 {{#crossLink "Sound/getCapabilities"}}{{/crossLink}} 方法了解如何重写插件的能力。
     * 
     * @method generateCapabiities
     * @static
     * @protected
     */
    WebAudioPlugin.generateCapabilities =
    function() {
        if (WebAudioPlugin.capabilities != null) {
            return;
        }
        // Web Audio can be in any formats supported by the audio element, from http://www.w3.org/TR/webaudio/#AudioContext-section,
        // therefore tag is still required for the capabilities check
        var t = document.createElement("audio");
        if (t.canPlayType == null) {
            return null;
        }
        // This check is first because it's what is currently used, but the spec calls for it to be AudioContext so this
        // will probably change in time
        if (window.webkitAudioContext) {
            WebAudioPlugin.context = new webkitAudioContext();
        } else if (window.AudioContext) {
            WebAudioPlugin.context = new AudioContext();
        } else {
            return null;
        }
        WebAudioPlugin.capabilities = {
            panning: true,
            volume: true,
            tracks: -1
        };
        // determine which extensions our browser supports for this plugin by iterating through Sound.SUPPORTED_EXTENSIONS
        var supportedExtensions = Sound.SUPPORTED_EXTENSIONS;
        var extensionMap = Sound.EXTENSION_MAP;
        for ( var i = 0, l = supportedExtensions.length; i < l; i++) {
            var ext = supportedExtensions[i];
            var playType = extensionMap[ext] || ext;
            WebAudioPlugin.capabilities[ext] =
            (t.canPlayType("audio/" + ext) != "no" && t.canPlayType("audio/" + ext) != "") 
            || (t.canPlayType("audio/" + playType) != "no" && t.canPlayType("audio/" + playType) != "");
        }
        // 0=no output, 1=mono, 2=stereo, 4=surround, 6=5.1 surround.
        // See http://www.w3.org/TR/webaudio/#AudioChannelSplitter for more details on channels.
        if (WebAudioPlugin.context.destination.numberOfChannels < 2) {
            WebAudioPlugin.capabilities.panning = false;
        }
        // set up AudioNodes that all of our source audio will connect to
        WebAudioPlugin.dynamicsCompressorNode = WebAudioPlugin.context.createDynamicsCompressor();
        WebAudioPlugin.dynamicsCompressorNode.connect(WebAudioPlugin.context.destination);
        WebAudioPlugin.gainNode = WebAudioPlugin.context.createGainNode();
        WebAudioPlugin.gainNode.connect(WebAudioPlugin.dynamicsCompressorNode);
    }

    return WebAudioPlugin;

});
