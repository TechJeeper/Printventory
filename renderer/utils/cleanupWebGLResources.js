// Add a function to clean up WebGL resources
function cleanupWebGLResources() {
  if (sharedRenderer) {
    sharedRenderer.dispose();
    sharedRenderer = null;
  }

  if (sharedScene) {
    sharedScene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
    sharedScene = null;
  }

  sharedCamera = null;
  contextUseCount = 0;

  // Force garbage collection if available
  if (typeof window.gc === 'function') {
    window.gc();
  }
}

// Add a periodic cleanup function
setInterval(() => {
  if (activeRenders === 0 && renderQueue.length === 0) {
    cleanupWebGLResources();
  }
}, 60000); // Clean up every minute if idle
