document.addEventListener("DOMContentLoaded", () => {
    const fullscreenBtn = document.getElementById("fullscreen-btn");

    if (fullscreenBtn) {
        fullscreenBtn.addEventListener("click", () => {
            try {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen();
                } else if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            } catch (e) {
                errorSystem.show('全屏切换失败: ' + e.message);
            }
        });
    }

    const BOARD_BASE_WIDTH = 1920;
    const BOARD_BASE_HEIGHT = 1080;
    const MIN_AUTO_ZOOM = 0.5;
    const MAX_AUTO_ZOOM = 2;

    const getUserZoom = () => {
        const value = parseFloat(document.body.dataset.userZoom);
        return Number.isFinite(value) && value > 0 ? value : 1;
    };

    const applyBoardZoom = () => {
        const widthRatio = window.innerWidth / BOARD_BASE_WIDTH;
        const heightRatio = window.innerHeight / BOARD_BASE_HEIGHT;
        const autoZoom = Math.min(widthRatio, heightRatio);
        const clampedAuto = Math.min(MAX_AUTO_ZOOM, Math.max(MIN_AUTO_ZOOM, autoZoom));
        const finalZoom = Number((clampedAuto * getUserZoom()).toFixed(3));

    if ('zoom' in document.body.style) {
            document.body.style.zoom = finalZoom;
            document.body.style.transform = "";
            document.body.style.transformOrigin = "";
            document.body.style.width = "";
            document.body.style.minHeight = "";
        } else {
            document.body.style.transform = `scale(${finalZoom})`;
            document.body.style.transformOrigin = "top left";
            document.body.style.width = `${window.innerWidth / finalZoom}px`;
            document.body.style.minHeight = `${window.innerHeight / finalZoom}px`;
        }

        document.body.dataset.appliedZoom = finalZoom;
    };

    window.boardZoom = {
        apply: applyBoardZoom,
        setUserZoom(zoom) {
            const parsed = parseFloat(zoom);
            document.body.dataset.userZoom = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
            applyBoardZoom();
        }
    };

    if (!document.body.dataset.userZoom) {
        document.body.dataset.userZoom = 1;
    }

    applyBoardZoom();
    window.addEventListener("resize", applyBoardZoom);
    window.addEventListener("boardZoomChange", applyBoardZoom);
});
