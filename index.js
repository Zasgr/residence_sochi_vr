'use strict';

(function() {
  var Marzipano = window.Marzipano;
  var bowser = window.bowser;
  var screenfull = window.screenfull;
  var data = window.APP_DATA;

  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  var isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  var panoElement = document.querySelector('#pano');
  var sceneNameElement = document.querySelector('#titleBar .sceneName');
  var sceneListElement = document.querySelector('#sceneList');
  var sceneElements = document.querySelectorAll('#sceneList .scene');
  var sceneListToggleElement = document.querySelector('#sceneListToggle');
  var autorotateToggleElement = document.querySelector('#autorotateToggle');
  var fullscreenToggleElement = document.querySelector('#fullscreenToggle');

  if (window.matchMedia) {
    var setMode = function() {
      if (mql.matches) {
        document.body.classList.remove('desktop');
        document.body.classList.add('mobile');
      } else {
        document.body.classList.remove('mobile');
        document.body.classList.add('desktop');
      }
    };
    var mql = matchMedia("(max-width: 500px), (max-height: 500px)");
    setMode();
    mql.addListener(setMode);
  } else {
    document.body.classList.add('desktop');
  }

  document.body.classList.add('no-touch');
  window.addEventListener('touchstart', function() {
    document.body.classList.remove('no-touch');
    document.body.classList.add('touch');
  });

  if (bowser.msie && parseFloat(bowser.version) < 11) {
    document.body.classList.add('tooltip-fallback');
  }

  // preserveDrawingBuffer нужен для захвата скриншота canvas
  var viewerOpts = {
    controls: {
      mouseViewMode: data.settings.mouseViewMode
    },
    stage: {
      preserveDrawingBuffer: true
    }
  };

  var viewer = new Marzipano.Viewer(panoElement, viewerOpts);

  // ============================================================
  // Плавность
  // ============================================================
  var DRAG_FRICTION = 2;
  var ZOOM_FRICTION = 3;

  setTimeout(function() {
    try {
      var ctls = viewer.controls();
      var methods = ctls._methods || [];
      if (typeof methods.forEach !== 'function') {
        if (typeof methods.length === 'number') {
          methods = Array.prototype.slice.call(methods);
        } else {
          methods = [];
        }
      }
      methods.forEach(function(m) {
        try {
          var inst = m.instance || m;
          if (!inst || !inst._dynamics) return;
          var dyn = inst._dynamics;
          if (dyn.x && dyn.y) {
            dyn.x._friction = DRAG_FRICTION;
            dyn.y._friction = DRAG_FRICTION;
          }
          if (typeof dyn._friction !== 'undefined') {
            dyn._friction = ZOOM_FRICTION;
          }
        } catch (e) {}
      });
    } catch (e) {}
  }, 200);

  // ============================================================
  // ОВЕРЛЕЙ С БЛЮРОМ
  // ============================================================
  var forceLoadId = 0;
  var FADE_OUT_MS = 500;
  var BLUR_AMOUNT = 20;       // пиксели блюра
  var BLUR_SCALE = 1.15;      // масштаб чтобы скрыть прозрачные края
  var currentOverlay = null;

  function captureScreenshot() {
    try {
      var cvs = panoElement.querySelector('canvas');
      if (cvs) {
        return cvs.toDataURL('image/jpeg', 0.5);
      }
    } catch (e) {}
    return null;
  }

  function createBlurOverlay(screenshotDataUrl) {
    // Удаляем предыдущий
    if (currentOverlay && currentOverlay.parentNode) {
      currentOverlay.parentNode.removeChild(currentOverlay);
    }

    var overlay = document.createElement('div');

    if (screenshotDataUrl && screenshotDataUrl.length > 500) {
      overlay.style.cssText =
        'position:absolute;top:0;left:0;width:100%;height:100%;' +
        'z-index:999;pointer-events:none;' +
        'background-image:url(' + screenshotDataUrl + ');' +
        'background-size:cover;background-position:center;' +
        '-webkit-filter:blur(' + BLUR_AMOUNT + 'px);' +
        'filter:blur(' + BLUR_AMOUNT + 'px);' +
        '-webkit-transform:scale(' + BLUR_SCALE + ');' +
        'transform:scale(' + BLUR_SCALE + ');' +
        'opacity:1;';
    } else {
      // Фоллбэк — чёрный экран если скриншот не удался
      overlay.style.cssText =
        'position:absolute;top:0;left:0;width:100%;height:100%;' +
        'z-index:999;pointer-events:none;background-color:#000;opacity:1;';
    }

    panoElement.appendChild(overlay);
    currentOverlay = overlay;
    return overlay;
  }

  function fadeOutOverlay(overlay, callback) {
    if (!overlay || !overlay.parentNode) {
      if (callback) callback();
      return;
    }

    overlay.style.transition =
      'opacity ' + FADE_OUT_MS + 'ms ease-out, ' +
      '-webkit-filter ' + FADE_OUT_MS + 'ms ease-out, ' +
      'filter ' + FADE_OUT_MS + 'ms ease-out';

    requestAnimationFrame(function() {
      overlay.style.opacity = '0';
      // Одновременно убираем блюр для эффекта «фокусировки»
      overlay.style.webkitFilter = 'blur(0px)';
      overlay.style.filter = 'blur(0px)';
    });

    setTimeout(function() {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (currentOverlay === overlay) {
        currentOverlay = null;
      }
      if (callback) callback();
    }, FADE_OUT_MS);
  }

  function removeOverlay(overlay) {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    if (currentOverlay === overlay) {
      currentOverlay = null;
    }
  }

  // ============================================================
  // ПРИНУДИТЕЛЬНАЯ ЗАГРУЗКА ВСЕХ ТАЙЛОВ
  // ============================================================
  function forceLoadAllTiles(sceneObj, overlay, onComplete) {
    var myId = ++forceLoadId;

    var view = sceneObj.view;
    var initParams = sceneObj.data.initialViewParameters;
    var fov = initParams.fov || 1.5;

    var positions = [];
    var yaws = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    var pitches = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2];

    for (var p = 0; p < pitches.length; p++) {
      for (var y = 0; y < yaws.length; y++) {
        positions.push({ yaw: yaws[y], pitch: pitches[p], fov: fov });
      }
    }
    positions.push({ yaw: 0, pitch: -1.5, fov: fov });
    positions.push({ yaw: Math.PI, pitch: -1.5, fov: fov });
    positions.push({ yaw: 0, pitch: 1.5, fov: fov });
    positions.push({ yaw: Math.PI, pitch: 1.5, fov: fov });
    positions.push({ yaw: Math.PI / 4, pitch: -1.3, fov: fov });
    positions.push({ yaw: -Math.PI / 4, pitch: 1.3, fov: fov });

    var idx = 0;
    var framesPerPosition = 2;
    var frameCount = 0;

    function tick() {
      if (myId !== forceLoadId) { removeOverlay(overlay); return; }

      if (idx < positions.length) {
        if (frameCount === 0) {
          view.setParameters(positions[idx]);
        }
        frameCount++;
        if (frameCount >= framesPerPosition) {
          frameCount = 0;
          idx++;
        }
        requestAnimationFrame(tick);
      } else {
        view.setParameters(initParams);

        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            requestAnimationFrame(function() {
              if (myId !== forceLoadId) { removeOverlay(overlay); return; }

              fadeOutOverlay(overlay, function() {
                if (onComplete) onComplete();
              });
            });
          });
        });
      }
    }

    requestAnimationFrame(tick);
  }

  // ============================================================
  // ФОНОВЫЙ HTTP-ПРЕДЗАГРУЗЧИК
  // ============================================================
  var bgPreloader = {
    queue: [],
    active: 0,
    maxActive: isMobile ? 2 : 4,
    seen: {},

    addScene: function(sceneId, levels) {
      var faces = ['b', 'd', 'f', 'l', 'r', 'u'];
      for (var z = 0; z < levels.length; z++) {
        var lvl = levels[z];
        var n = Math.ceil(lvl.size / lvl.tileSize);
        for (var f = 0; f < 6; f++) {
          for (var row = 0; row < n; row++) {
            for (var col = 0; col < n; col++) {
              var url = 'tiles/' + sceneId + '/' + (z + 1) + '/' +
                        faces[f] + '/' + row + '/' + col + '.jpg';
              if (!this.seen[url]) {
                this.seen[url] = true;
                this.queue.push(url);
              }
            }
          }
        }
      }
      this.process();
    },

    process: function() {
      var self = this;
      while (self.active < self.maxActive && self.queue.length > 0) {
        self.active++;
        (function() {
          var img = new Image();
          img.onload = img.onerror = function() {
            self.active--;
            self.process();
          };
          img.src = self.queue.shift();
        })();
      }
    },

    clear: function() {
      this.queue = [];
    }
  };

  // ============================================================

  var scenes = data.scenes.map(function(sceneData) {
    var urlPrefix = "tiles";

    var sourceOptions = isIOS
      ? {}
      : { cubeMapPreviewUrl: urlPrefix + "/" + sceneData.id + "/preview.jpg" };

    var source = Marzipano.ImageUrlSource.fromString(
      urlPrefix + "/" + sceneData.id + "/{z}/{f}/{y}/{x}.jpg",
      sourceOptions);

    var geometry = new Marzipano.CubeGeometry(sceneData.levels);

    var limiter = Marzipano.RectilinearView.limit.traditional(
      sceneData.faceSize * 4,
      120 * Math.PI / 180,
      150 * Math.PI / 180
    );

    var view = new Marzipano.RectilinearView(sceneData.initialViewParameters, limiter);

    var scene = viewer.createScene({
      source: source,
      geometry: geometry,
      view: view,
      pinFirstLevel: true
    });

    sceneData.linkHotspots.forEach(function(hotspot) {
      var element = createLinkHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, {
        yaw: hotspot.yaw, pitch: hotspot.pitch
      });
    });

    sceneData.infoHotspots.forEach(function(hotspot) {
      var element = createInfoHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, {
        yaw: hotspot.yaw, pitch: hotspot.pitch
      });
    });

    return {
      data: sceneData,
      scene: scene,
      view: view
    };
  });

  var autorotate = Marzipano.autorotate({
    yawSpeed: 0.03,
    targetPitch: 0,
    targetFov: Math.PI / 2
  });
  if (data.settings.autorotateEnabled) {
    autorotateToggleElement.classList.add('enabled');
  }

  autorotateToggleElement.addEventListener('click', toggleAutorotate);

  // Fullscreen
  document.body.classList.remove('fullscreen-disabled');
  document.body.classList.add('fullscreen-enabled');

  var useNativeFullscreen = !isIOS && screenfull && screenfull.enabled;
  var isPseudoFullscreen = false;

  fullscreenToggleElement.addEventListener('click', function() {
    if (useNativeFullscreen) {
      screenfull.toggle();
    } else {
      togglePseudoFullscreen();
    }
  });

  if (useNativeFullscreen) {
    screenfull.on('change', function() {
      if (screenfull.isFullscreen) {
        fullscreenToggleElement.classList.add('enabled');
      } else {
        fullscreenToggleElement.classList.remove('enabled');
      }
    });
  }

  function togglePseudoFullscreen() {
    isPseudoFullscreen = !isPseudoFullscreen;

    if (isPseudoFullscreen) {
      document.body.classList.add('pseudo-fullscreen');
      fullscreenToggleElement.classList.add('enabled');
      window.scrollTo(0, 0);
      setTimeout(function() { window.scrollTo(0, 1); }, 50);
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.body.classList.remove('pseudo-fullscreen');
      fullscreenToggleElement.classList.remove('enabled');
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }

    setTimeout(function() { viewer.updateSize(); }, 100);
    setTimeout(function() { viewer.updateSize(); }, 300);
  }

  window.addEventListener('orientationchange', function() {
    setTimeout(function() { viewer.updateSize(); }, 200);
    setTimeout(function() { viewer.updateSize(); }, 500);
  });

  window.addEventListener('resize', function() {
    setTimeout(function() { viewer.updateSize(); }, 100);
  });

  sceneListToggleElement.addEventListener('click', toggleSceneList);

  if (!document.body.classList.contains('mobile')) {
    showSceneList();
  }

  scenes.forEach(function(scene) {
    var el = document.querySelector(
      '#sceneList .scene[data-id="' + scene.data.id + '"]');
    el.addEventListener('click', function() {
      switchScene(scene);
      if (document.body.classList.contains('mobile')) {
        hideSceneList();
      }
    });
  });

  var viewUpElement = document.querySelector('#viewUp');
  var viewDownElement = document.querySelector('#viewDown');
  var viewLeftElement = document.querySelector('#viewLeft');
  var viewRightElement = document.querySelector('#viewRight');
  var viewInElement = document.querySelector('#viewIn');
  var viewOutElement = document.querySelector('#viewOut');

  var velocity = 0.7;
  var friction = 3;

  var controls = viewer.controls();
  controls.registerMethod('upElement',
    new Marzipano.ElementPressControlMethod(viewUpElement, 'y', -velocity, friction), true);
  controls.registerMethod('downElement',
    new Marzipano.ElementPressControlMethod(viewDownElement, 'y', velocity, friction), true);
  controls.registerMethod('leftElement',
    new Marzipano.ElementPressControlMethod(viewLeftElement, 'x', -velocity, friction), true);
  controls.registerMethod('rightElement',
    new Marzipano.ElementPressControlMethod(viewRightElement, 'x', velocity, friction), true);
  controls.registerMethod('inElement',
    new Marzipano.ElementPressControlMethod(viewInElement, 'zoom', -velocity, friction), true);
  controls.registerMethod('outElement',
    new Marzipano.ElementPressControlMethod(viewOutElement, 'zoom', velocity, friction), true);

  function sanitize(s) {
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;');
  }

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЕ СЦЕНЫ
  // 1. Скриншот текущего кадра → блюр-оверлей
  // 2. Переключение сцены за оверлеем
  // 3. Сканирование всех граней
  // 4. Плавное проявление с эффектом фокусировки
  // ============================================================
  var isFirstScene = true;

  function switchScene(scene) {
    forceLoadId++;
    stopAutorotate();
    bgPreloader.clear();

    // 1. Захватываем скриншот ДО переключения (кроме первого запуска)
    var screenshot = null;
    if (!isFirstScene) {
      screenshot = captureScreenshot();
    }
    isFirstScene = false;

    // 2. Мгновенно показываем блюр предыдущего кадра
    var overlay = createBlurOverlay(screenshot);

    // 3. Переключаем сцену за оверлеем
    scene.view.setParameters(scene.data.initialViewParameters);
    scene.scene.switchTo();

    requestAnimationFrame(function() {
      scene.view.setParameters(scene.data.initialViewParameters);

      // 4. Ждём начальные тайлы, затем сканируем
      setTimeout(function() {

        forceLoadAllTiles(scene, overlay, function() {
          startAutorotate();

          var hotspots = scene.data.linkHotspots || [];
          for (var i = 0; i < hotspots.length; i++) {
            var sd = findSceneDataById(hotspots[i].target);
            if (sd) bgPreloader.addScene(sd.id, sd.levels);
          }

          for (var j = 0; j < data.scenes.length; j++) {
            var s = data.scenes[j];
            if (s.id !== scene.data.id) {
              bgPreloader.addScene(s.id, s.levels);
            }
          }
        });

      }, 500);
    });

    updateSceneName(scene);
    updateSceneList(scene);
  }

  function updateSceneName(scene) {
    sceneNameElement.innerHTML = sanitize(scene.data.name);
  }

  function updateSceneList(scene) {
    for (var i = 0; i < sceneElements.length; i++) {
      var el = sceneElements[i];
      if (el.getAttribute('data-id') === scene.data.id) {
        el.classList.add('current');
      } else {
        el.classList.remove('current');
      }
    }
  }

  function showSceneList() {
    sceneListElement.classList.add('enabled');
    sceneListToggleElement.classList.add('enabled');
  }

  function hideSceneList() {
    sceneListElement.classList.remove('enabled');
    sceneListToggleElement.classList.remove('enabled');
  }

  function toggleSceneList() {
    sceneListElement.classList.toggle('enabled');
    sceneListToggleElement.classList.toggle('enabled');
  }

  function startAutorotate() {
    if (!autorotateToggleElement.classList.contains('enabled')) {
      return;
    }
    viewer.startMovement(autorotate);
    viewer.setIdleMovement(3000, autorotate);
  }

  function stopAutorotate() {
    viewer.stopMovement();
    viewer.setIdleMovement(Infinity);
  }

  function toggleAutorotate() {
    if (autorotateToggleElement.classList.contains('enabled')) {
      autorotateToggleElement.classList.remove('enabled');
      stopAutorotate();
    } else {
      autorotateToggleElement.classList.add('enabled');
      startAutorotate();
    }
  }

  function createLinkHotspotElement(hotspot) {

    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('link-hotspot');

    var icon = document.createElement('img');
    icon.src = 'img/pin2.svg';
    icon.classList.add('link-hotspot-icon');

    var transformProperties = ['-ms-transform', '-webkit-transform', 'transform'];
    for (var i = 0; i < transformProperties.length; i++) {
      var property = transformProperties[i];
      icon.style[property] = 'rotate(' + hotspot.rotation + 'rad)';
    }

    wrapper.addEventListener('click', function() {
      switchScene(findSceneById(hotspot.target));
    });

    stopTouchAndScrollEventPropagation(wrapper);

    var tooltip = document.createElement('div');
    tooltip.classList.add('hotspot-tooltip');
    tooltip.classList.add('link-hotspot-tooltip');
    tooltip.innerHTML = findSceneDataById(hotspot.target).name;

    wrapper.appendChild(icon);
    wrapper.appendChild(tooltip);

    return wrapper;
  }

  function createInfoHotspotElement(hotspot) {

    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('info-hotspot');

    var header = document.createElement('div');
    header.classList.add('info-hotspot-header');

    var iconWrapper = document.createElement('div');
    iconWrapper.classList.add('info-hotspot-icon-wrapper');
    var icon = document.createElement('img');
    icon.src = 'img/info.svg';
    icon.classList.add('info-hotspot-icon');
    iconWrapper.appendChild(icon);

    var titleWrapper = document.createElement('div');
    titleWrapper.classList.add('info-hotspot-title-wrapper');
    var title = document.createElement('div');
    title.classList.add('info-hotspot-title');
    title.innerHTML = hotspot.title;
    titleWrapper.appendChild(title);

    var closeWrapper = document.createElement('div');
    closeWrapper.classList.add('info-hotspot-close-wrapper');
    var closeIcon = document.createElement('img');
    closeIcon.src = 'img/close.svg';
    closeIcon.classList.add('info-hotspot-close-icon');
    closeWrapper.appendChild(closeIcon);

    header.appendChild(iconWrapper);
    header.appendChild(titleWrapper);
    header.appendChild(closeWrapper);

    var text = document.createElement('div');
    text.classList.add('info-hotspot-text');
    text.innerHTML = hotspot.text;

    wrapper.appendChild(header);
    wrapper.appendChild(text);

    var modal = document.createElement('div');
    modal.innerHTML = wrapper.innerHTML;
    modal.classList.add('info-hotspot-modal');
    document.body.appendChild(modal);

    var toggle = function() {
      wrapper.classList.toggle('visible');
      modal.classList.toggle('visible');
    };

    wrapper.querySelector('.info-hotspot-header').addEventListener('click', toggle);
    modal.querySelector('.info-hotspot-close-wrapper').addEventListener('click', toggle);

    stopTouchAndScrollEventPropagation(wrapper);

    return wrapper;
  }

  function stopTouchAndScrollEventPropagation(element, eventList) {
    var eventList = ['touchstart', 'touchmove', 'touchend', 'touchcancel',
                     'wheel', 'mousewheel'];
    for (var i = 0; i < eventList.length; i++) {
      element.addEventListener(eventList[i], function(event) {
        event.stopPropagation();
      });
    }
  }

  function findSceneById(id) {
    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i].data.id === id) {
        return scenes[i];
      }
    }
    return null;
  }

  function findSceneDataById(id) {
    for (var i = 0; i < data.scenes.length; i++) {
      if (data.scenes[i].id === id) {
        return data.scenes[i];
      }
    }
    return null;
  }

  switchScene(scenes[0]);

})();