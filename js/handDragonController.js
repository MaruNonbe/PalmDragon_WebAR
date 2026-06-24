/**
 * HandDragonController
 *
 * MediaPipe Hand Landmarker の21点ランドマークを受け取り、
 * 手のひら中心・手のサイズ・開き具合・左右判定などを扱うクラスです。
 *
 * 使用ランドマーク:
 * 0  = wrist
 * 5  = index_finger_mcp
 * 9  = middle_finger_mcp
 * 13 = ring_finger_mcp
 * 17 = pinky_mcp
 */

export class HandDragonController {
  constructor(options = {}) {
    this.video = options.video;
    this.debugCanvas = options.debugCanvas;

    this.ctx = this.debugCanvas.getContext("2d");

    this.showDebug = false;
    this.showLandmarks = true;
    this.showNumbers = false;

    this.lastHandInfo = null;
  }

  setDebugEnabled(enabled) {
    this.showDebug = enabled;
    this.showNumbers = enabled;
    this.clearDebugCanvas();
  }

  setLandmarksEnabled(enabled) {
    this.showLandmarks = enabled;
    this.clearDebugCanvas();
  }

  resizeDebugCanvas(width, height, dpr = 1) {
    this.debugCanvas.width = Math.floor(width * dpr);
    this.debugCanvas.height = Math.floor(height * dpr);
    this.debugCanvas.style.width = `${width}px`;
    this.debugCanvas.style.height = `${height}px`;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clearDebugCanvas() {
    const rect = this.debugCanvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
  }

  /**
   * MediaPipeの結果から、表示に必要な手情報を取り出す。
   */
  extractHandInfo(results) {
    if (
      !results ||
      !results.landmarks ||
      results.landmarks.length === 0
    ) {
      this.lastHandInfo = null;
      this.clearDebugCanvas();
      return null;
    }

    const landmarks = results.landmarks[0];

    const handedness =
      results.handednesses &&
      results.handednesses[0] &&
      results.handednesses[0][0]
        ? results.handednesses[0][0].categoryName
        : "Unknown";

    const palmCenter = this.calculatePalmCenter(landmarks);
    const palmSize = this.calculatePalmSize(landmarks);
    const openScore = this.calculateOpenScore(landmarks);
    const isOpen = openScore >= 3;

    const screenCenter = this.landmarkToScreenPoint(palmCenter);

    const handInfo = {
      landmarks,
      handedness,
      palmCenter,
      palmSize,
      openScore,
      isOpen,
      screenCenter
    };

    this.lastHandInfo = handInfo;
    this.drawDebug(handInfo);

    return handInfo;
  }

  /**
   * 手のひら中心。
   * 0,5,9,13,17 の平均。
   */
  calculatePalmCenter(landmarks) {
    const ids = [0, 5, 9, 13, 17];

    const center = ids.reduce(
      (sum, id) => {
        sum.x += landmarks[id].x;
        sum.y += landmarks[id].y;
        sum.z += landmarks[id].z || 0;
        return sum;
      },
      { x: 0, y: 0, z: 0 }
    );

    center.x /= ids.length;
    center.y /= ids.length;
    center.z /= ids.length;

    return center;
  }

  /**
   * 手の大きさ。
   * 人差し指MCP〜小指MCPの幅と、手首〜中指MCPの距離を組み合わせる。
   */
  calculatePalmSize(landmarks) {
    const width = this.distance2D(landmarks[5], landmarks[17]);
    const height = this.distance2D(landmarks[0], landmarks[9]);

    return Math.max(0.02, (width + height) * 0.5);
  }

  /**
   * 手が開いているかの簡易判定。
   * 厳しすぎると初期体験が悪くなるため、3本以上伸びていれば「開いている」とみなす。
   */
  calculateOpenScore(landmarks) {
    const wrist = landmarks[0];

    const fingers = [
      { tip: 8, pip: 6, mcp: 5 },
      { tip: 12, pip: 10, mcp: 9 },
      { tip: 16, pip: 14, mcp: 13 },
      { tip: 20, pip: 18, mcp: 17 }
    ];

    let score = 0;

    for (const finger of fingers) {
      const tipDist = this.distance2D(landmarks[finger.tip], wrist);
      const pipDist = this.distance2D(landmarks[finger.pip], wrist);
      const mcpDist = this.distance2D(landmarks[finger.mcp], wrist);

      if (tipDist > pipDist * 1.05 && tipDist > mcpDist * 1.25) {
        score++;
      }
    }

    return score;
  }

  /**
   * MediaPipeの正規化座標を、画面上のピクセル座標へ変換する。
   * video要素が object-fit: cover のため、上下左右の切り抜きを考慮する。
   */
  landmarkToScreenPoint(landmark) {
    const rect = this.video.getBoundingClientRect();

    const videoWidth = this.video.videoWidth || rect.width;
    const videoHeight = this.video.videoHeight || rect.height;

    const viewWidth = rect.width;
    const viewHeight = rect.height;

    const scale = Math.max(
      viewWidth / videoWidth,
      viewHeight / videoHeight
    );

    const displayedWidth = videoWidth * scale;
    const displayedHeight = videoHeight * scale;

    const offsetX = (viewWidth - displayedWidth) * 0.5;
    const offsetY = (viewHeight - displayedHeight) * 0.5;

    const x = landmark.x * displayedWidth + offsetX;
    const y = landmark.y * displayedHeight + offsetY;

    return { x, y };
  }

  drawDebug(handInfo) {
    this.clearDebugCanvas();

    if (!this.showLandmarks && !this.showDebug) {
      return;
    }

    const { landmarks, palmCenter, screenCenter } = handInfo;

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17]
    ];

    this.ctx.save();
    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = "rgba(100, 220, 255, 0.85)";
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    this.ctx.font = "11px system-ui, sans-serif";

    for (const [a, b] of connections) {
      const pa = this.landmarkToScreenPoint(landmarks[a]);
      const pb = this.landmarkToScreenPoint(landmarks[b]);

      this.ctx.beginPath();
      this.ctx.moveTo(pa.x, pa.y);
      this.ctx.lineTo(pb.x, pb.y);
      this.ctx.stroke();
    }

    landmarks.forEach((lm, index) => {
      const p = this.landmarkToScreenPoint(lm);

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      this.ctx.fill();

      if (this.showNumbers) {
        this.ctx.fillText(String(index), p.x + 6, p.y - 6);
      }
    });

    const palmScreen = this.landmarkToScreenPoint(palmCenter);

    this.ctx.strokeStyle = "rgba(255, 220, 80, 0.95)";
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.arc(palmScreen.x, palmScreen.y, 20, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(255, 230, 120, 1)";
    this.ctx.beginPath();
    this.ctx.arc(screenCenter.x, screenCenter.y, 6, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  distance2D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}