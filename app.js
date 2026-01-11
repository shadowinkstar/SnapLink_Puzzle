import { createApp } from './node_modules/vue/dist/vue.esm-browser.prod.js';
import * as PIXI from 'https://cdn.jsdelivr.net/npm/pixi.js@7.4.0/dist/pixi.min.mjs';

const builtInImages = [
  {
    id: 'campus',
    name: '清新校园',
    src: 'assets/anime-campus.svg'
  },
  {
    id: 'cyber',
    name: '夜景赛博城市',
    src: 'assets/anime-cyber-city.svg'
  },
  {
    id: 'chibi',
    name: '萌系小动物',
    src: 'assets/anime-chibi-cat.svg'
  }
];

createApp({
  data() {
    return {
      builtInImages,
      selectedBuiltInId: builtInImages[0].id,
      gridSize: 6,
      rows: 6,
      cols: 6,
      showNumbers: true,
      cropSquare: true,
      pieces: [],
      clusters: new Map(),
      grid: [],
      imageDataUrl: '',
      moveCount: 0,
      startTime: null,
      timerId: null,
      timeElapsed: '00:00',
      dragging: null,
      dragFrameId: null,
      pendingDrag: null,
      boardSize: 0,
      pieceSize: 0,
      isComplete: false,
      winVisible: false,
      winStats: '',
      uploadedFile: null
    };
  },
  watch: {
    gridSize(newSize) {
      this.rows = newSize;
      this.cols = newSize;
      this.resetGame();
    },
    showNumbers() {
      this.updateLabelVisibility();
    }
  },
  mounted() {
    this.rows = this.gridSize;
    this.cols = this.gridSize;
    this.dragFrameId = null;
    this.pendingDrag = null;
    this.dragOffset = { dx: 0, dy: 0 };
    window.addEventListener('resize', this.handleResize);
    this.initPixi();
    this.loadBuiltIn(this.builtInImages[0]);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    if (this.timerId) {
      clearInterval(this.timerId);
    }
    this.destroyPixi();
  },
  methods: {
    initPixi() {
      if (this.pixiApp) {
        return;
      }
      const boardEl = this.$refs.board;
      if (!boardEl) {
        return;
      }
      const app = new PIXI.Application({
        backgroundAlpha: 0,
        antialias: true,
        resizeTo: boardEl
      });
      app.stage.sortableChildren = true;
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;
      app.stage.on('pointermove', (event) => this.handlePointerMove(event));
      app.stage.on('pointerup', (event) => this.handlePointerUp(event));
      app.stage.on('pointerupoutside', (event) => this.handlePointerUp(event));
      app.view.style.width = '100%';
      app.view.style.height = '100%';
      app.view.style.display = 'block';
      boardEl.innerHTML = '';
      boardEl.appendChild(app.view);
      const container = new PIXI.Container();
      app.stage.addChild(container);
      this.pixiApp = app;
      this.pixiContainer = container;
    },
    destroyPixi() {
      if (this.pixiApp) {
        this.pixiApp.destroy(true, { children: true, texture: true, baseTexture: true });
        this.pixiApp = null;
        this.pixiContainer = null;
        this.pixiPieces = new Map();
        this.pixiLabels = new Map();
        this.baseTexture = null;
      }
    },
    clearPixiPieces() {
      if (!this.pixiContainer) {
        return;
      }
      this.pixiContainer.removeChildren().forEach((child) => child.destroy());
      this.pixiPieces.clear();
      this.pixiLabels.clear();
    },
    handleResize() {
      this.updateBoardMetrics();
      this.layoutPieces();
    },
    handleBuiltInChange() {
      const selected = this.builtInImages.find((image) => image.id === this.selectedBuiltInId);
      if (selected) {
        this.uploadedFile = null;
        this.loadBuiltIn(selected);
      }
    },
    async loadBuiltIn(image) {
      const response = await fetch(image.src);
      const blob = await response.blob();
      const bitmap = await this.loadBitmap(blob);
      await this.setImageFromBitmap(bitmap);
    },
    async handleUpload(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) {
        return;
      }
      this.uploadedFile = file;
      const bitmap = await this.loadBitmap(file);
      await this.setImageFromBitmap(bitmap);
    },
    async handleCropChange() {
      if (this.uploadedFile) {
        const bitmap = await this.loadBitmap(this.uploadedFile);
        await this.setImageFromBitmap(bitmap);
        return;
      }
      this.resetGame();
    },
    async loadBitmap(source) {
      if ('createImageBitmap' in window) {
        return createImageBitmap(source, { imageOrientation: 'from-image' });
      }
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(source);
      });
    },
    async setImageFromBitmap(bitmap) {
      const dataUrl = this.renderImage(bitmap, this.cropSquare);
      this.imageDataUrl = dataUrl;
      await this.loadPixiTexture(dataUrl);
      this.resetGame();
    },
    renderImage(bitmap, cropSquare) {
      const maxSize = 2048;
      const sourceWidth = bitmap.width;
      const sourceHeight = bitmap.height;
      const cropSize = cropSquare ? Math.min(sourceWidth, sourceHeight) : Math.max(sourceWidth, sourceHeight);

      const sx = cropSquare ? Math.max(0, (sourceWidth - cropSize) / 2) : 0;
      const sy = cropSquare ? Math.max(0, (sourceHeight - cropSize) / 2) : 0;
      const sWidth = cropSquare ? cropSize : sourceWidth;
      const sHeight = cropSquare ? cropSize : sourceHeight;
      const targetSize = Math.min(maxSize, Math.max(sWidth, sHeight));
      const canvas = document.createElement('canvas');
      canvas.width = cropSquare ? targetSize : Math.round((sWidth / sHeight) * targetSize);
      canvas.height = cropSquare ? targetSize : Math.round((sHeight / sWidth) * targetSize);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    },
    resetGame() {
      this.clearBoard();
      this.buildPieces();
      this.shufflePieces();
      this.updateMoveCount(0);
      this.resetTimer();
    },
    clearBoard() {
      this.pieces = [];
      this.clusters = new Map();
      this.grid = [];
      this.isComplete = false;
      this.winVisible = false;
      this.clearPixiPieces();
    },
    buildPieces() {
      this.updateBoardMetrics();
      this.initPixi();
      this.prepareTexture();
      const total = this.rows * this.cols;
      this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));

      const pieces = [];
      const clusters = new Map();

      for (let i = 0; i < total; i += 1) {
        const correctRow = Math.floor(i / this.cols);
        const correctCol = i % this.cols;
        const piece = {
          id: i,
          correctRow,
          correctCol,
          currentRow: correctRow,
          currentCol: correctCol,
          clusterId: i,
          flashActive: false,
          flashTimer: null
        };

        pieces.push(piece);
        clusters.set(piece.clusterId, new Set([piece.id]));
      }

      this.pieces = pieces;
      this.clusters = clusters;
      this.createPixiPieces();
      this.layoutPieces();
    },
    updateBoardMetrics() {
      const boardEl = this.$refs.board;
      if (!boardEl) {
        return;
      }
      const rect = boardEl.getBoundingClientRect();
      this.boardSize = rect.width;
      this.pieceSize = rect.width / this.cols;
    },
    layoutPieces() {
      if (!this.pieces.length) {
        return;
      }
      this.renderPiecePositions();
    },
    pieceStyle(piece) {
      const translate = this.dragging && this.dragging.clusterPieces.includes(piece.id)
        ? `translate3d(${this.dragging.dx}px, ${this.dragging.dy}px, 0)`
        : '';

      return {
        width: `${this.pieceSize}px`,
        height: `${this.pieceSize}px`,
        left: `${piece.currentCol * this.pieceSize}px`,
        top: `${piece.currentRow * this.pieceSize}px`,
        backgroundImage: `url(${this.imageDataUrl})`,
        backgroundSize: `${this.boardSize}px ${this.boardSize}px`,
        backgroundPosition: `-${piece.correctCol * this.pieceSize}px -${piece.correctRow * this.pieceSize}px`
      };
    },
    shufflePieces() {
      const total = this.rows * this.cols;
      const indices = Array.from({ length: total }, (_, i) => i);
      let isSolved = true;

      while (isSolved) {
        for (let i = indices.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        isSolved = indices.every((value, index) => value === index);
      }

      indices.forEach((cellIndex, pieceId) => {
        const row = Math.floor(cellIndex / this.cols);
        const col = cellIndex % this.cols;
        const piece = this.pieces[pieceId];
        piece.currentRow = row;
        piece.currentCol = col;
        piece.clusterId = piece.id;
      });

      this.clusters = new Map();
      this.pieces.forEach((piece) => {
        this.clusters.set(piece.clusterId, new Set([piece.id]));
      });

      this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
      this.pieces.forEach((piece) => {
        this.grid[piece.currentRow][piece.currentCol] = piece.id;
      });

      this.isComplete = false;
      this.layoutPieces();
    },
    updateMoveCount(value) {
      this.moveCount = value;
    },
    resetTimer() {
      if (this.timerId) {
        clearInterval(this.timerId);
      }
      this.startTime = Date.now();
      this.updateTimer();
      this.timerId = setInterval(this.updateTimer, 1000);
    },
    updateTimer() {
      if (!this.startTime) {
        return;
      }
      const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
      const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
      const seconds = String(elapsedSeconds % 60).padStart(2, '0');
      this.timeElapsed = `${minutes}:${seconds}`;
    },
    handleShuffle() {
      this.shufflePieces();
      this.updateMoveCount(0);
      this.resetTimer();
    },
    handlePlayAgain() {
      this.winVisible = false;
      this.shufflePieces();
      this.updateMoveCount(0);
      this.resetTimer();
    },
    handleCloseModal() {
      this.winVisible = false;
    },
    handlePointerDown(event) {
      if (this.isComplete || !event.target || !event.target.__pieceId) {
        return;
      }
      const pieceId = event.target.__pieceId;
      const piece = this.pieces[pieceId];
      const clusterPieces = Array.from(this.clusters.get(piece.clusterId));
      const clusterPiecesSet = new Set(clusterPieces);

      this.dragging = {
        clusterId: piece.clusterId,
        pieceId,
        startX: event.clientX,
        startY: event.clientY,
        clusterPieces,
        clusterPiecesSet,
        originalPositions: clusterPieces.map((id) => ({
          id,
          row: this.pieces[id].currentRow,
          col: this.pieces[id].currentCol
        })),
        originalPositionMap: new Map(
          clusterPieces.map((id) => [
            id,
            {
              row: this.pieces[id].currentRow,
              col: this.pieces[id].currentCol
            }
          ])
        )
      };
      this.pendingDrag = { dx: 0, dy: 0 };
    },
    handlePointerMove(event) {
      if (!this.dragging) {
        return;
      }
      event.preventDefault();
      this.pendingDrag = {
        dx: event.clientX - this.dragging.startX,
        dy: event.clientY - this.dragging.startY
      };
      if (this.dragFrameId) {
        return;
      }
      this.dragFrameId = requestAnimationFrame(() => {
        this.dragFrameId = null;
        if (!this.dragging || !this.pendingDrag) {
          return;
        }
        this.dragging.dx = this.pendingDrag.dx;
        this.dragging.dy = this.pendingDrag.dy;
      });
    },
    handlePointerUp(event) {
      if (!this.dragging) {
        return;
      }
       if (this.dragFrameId) {
        cancelAnimationFrame(this.dragFrameId);
        this.dragFrameId = null;
      }
      this.pendingDrag = null;

      const { clusterId, pieceId, clusterPieces } = this.dragging;

      const targetRow = this.clamp(Math.floor(event.global.y / this.pieceSize), 0, this.rows - 1);
      const targetCol = this.clamp(Math.floor(event.global.x / this.pieceSize), 0, this.cols - 1);
      const targetPieceId = this.grid[targetRow][targetCol];

      if (targetPieceId == null) {
        this.dragging = null;
        return;
      }

      const targetClusterId = this.pieces[targetPieceId].clusterId;
      if (targetClusterId === clusterId) {
        this.dragging = null;
        return;
      }

      const originPiece = this.pieces[pieceId];
      const offsetRow = targetRow - originPiece.currentRow;
      const offsetCol = targetCol - originPiece.currentCol;

      const clusterA = Array.from(this.clusters.get(clusterId));
      const clusterB = Array.from(this.clusters.get(targetClusterId));

      const occupied = new Set();
      this.pieces.forEach((piece) => {
        if (piece.clusterId !== clusterId && piece.clusterId !== targetClusterId) {
          occupied.add(`${piece.currentRow},${piece.currentCol}`);
        }
      });

      const newPositionsA = clusterA.map((id) => ({
        id,
        row: this.pieces[id].currentRow + offsetRow,
        col: this.pieces[id].currentCol + offsetCol
      }));

      const newPositionsB = clusterB.map((id) => ({
        id,
        row: this.pieces[id].currentRow - offsetRow,
        col: this.pieces[id].currentCol - offsetCol
      }));

      const validMove = this.isPositionsValid(newPositionsA, newPositionsB, occupied);
      if (!validMove) {
        this.dragging = null;
        return;
      }

      this.updateClusterPositions(newPositionsA, newPositionsB);
      this.updateMoveCount(this.moveCount + 1);
      this.checkAndMergeClusters([clusterId, targetClusterId]);
      this.checkWinCondition();

      this.dragging = null;
    },
    isPositionsValid(newPositionsA, newPositionsB, occupied) {
      const allPositions = new Set();
      const checkPositions = (positions) => positions.every((pos) => {
        if (pos.row < 0 || pos.row >= this.rows || pos.col < 0 || pos.col >= this.cols) {
          return false;
        }
        const key = `${pos.row},${pos.col}`;
        if (occupied.has(key) || allPositions.has(key)) {
          return false;
        }
        allPositions.add(key);
        return true;
      });

      return checkPositions(newPositionsA) && checkPositions(newPositionsB);
    },
    updateClusterPositions(newPositionsA, newPositionsB) {
      newPositionsA.forEach((pos) => {
        const piece = this.pieces[pos.id];
        this.grid[piece.currentRow][piece.currentCol] = null;
      });
      newPositionsB.forEach((pos) => {
        const piece = this.pieces[pos.id];
        this.grid[piece.currentRow][piece.currentCol] = null;
      });

      newPositionsA.forEach((pos) => {
        const piece = this.pieces[pos.id];
        piece.currentRow = pos.row;
        piece.currentCol = pos.col;
        this.grid[pos.row][pos.col] = piece.id;
      });

      newPositionsB.forEach((pos) => {
        const piece = this.pieces[pos.id];
        piece.currentRow = pos.row;
        piece.currentCol = pos.col;
        this.grid[pos.row][pos.col] = piece.id;
      });

      this.layoutPieces();
    },
    checkAndMergeClusters(clusterIds) {
      let merged = true;
      while (merged) {
        merged = false;
        clusterIds.forEach((clusterId) => {
          const pieceIds = Array.from(this.clusters.get(clusterId) || []);
          pieceIds.forEach((pieceId) => {
            const piece = this.pieces[pieceId];
            const neighbors = [
              { row: piece.currentRow - 1, col: piece.currentCol, dr: -1, dc: 0 },
              { row: piece.currentRow + 1, col: piece.currentCol, dr: 1, dc: 0 },
              { row: piece.currentRow, col: piece.currentCol - 1, dr: 0, dc: -1 },
              { row: piece.currentRow, col: piece.currentCol + 1, dr: 0, dc: 1 }
            ];

            neighbors.forEach((neighbor) => {
              if (neighbor.row < 0 || neighbor.row >= this.rows || neighbor.col < 0 || neighbor.col >= this.cols) {
                return;
              }
              const neighborId = this.grid[neighbor.row][neighbor.col];
              if (neighborId == null) {
                return;
              }
              const neighborPiece = this.pieces[neighborId];
              if (piece.clusterId === neighborPiece.clusterId) {
                return;
              }

              const correctNeighborRow = piece.correctRow + neighbor.dr;
              const correctNeighborCol = piece.correctCol + neighbor.dc;
              const isCorrectNeighbor = neighborPiece.correctRow === correctNeighborRow
                && neighborPiece.correctCol === correctNeighborCol;

              if (isCorrectNeighbor) {
                this.mergeClusters(piece.clusterId, neighborPiece.clusterId);
                this.flashCluster(piece.clusterId);
                merged = true;
              }
            });
          });
        });
      }
    },
    mergeClusters(targetClusterId, sourceClusterId) {
      if (targetClusterId === sourceClusterId) {
        return;
      }
      const targetSet = this.clusters.get(targetClusterId);
      const sourceSet = this.clusters.get(sourceClusterId);
      if (!targetSet || !sourceSet) {
        return;
      }
      sourceSet.forEach((id) => {
        targetSet.add(id);
        this.pieces[id].clusterId = targetClusterId;
      });
      this.clusters.delete(sourceClusterId);
    },
    flashCluster(clusterId) {
      const pieceIds = Array.from(this.clusters.get(clusterId) || []);
      pieceIds.forEach((id) => {
        const piece = this.pieces[id];
        piece.flashActive = false;
      });
      this.$nextTick(() => {
        pieceIds.forEach((id) => {
          const piece = this.pieces[id];
          piece.flashActive = true;
          if (piece.flashTimer) {
            clearTimeout(piece.flashTimer);
          }
          piece.flashTimer = setTimeout(() => {
            piece.flashActive = false;
          }, 450);
        });
      });
    },
    checkWinCondition() {
      const allCorrect = this.pieces.every(
        (piece) => piece.currentRow === piece.correctRow && piece.currentCol === piece.correctCol
      );
      if (!allCorrect) {
        return;
      }
      this.isComplete = true;
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
      this.showWinModal();
    },
    showWinModal() {
      this.winVisible = true;
      this.winStats = `用时 ${this.timeElapsed}，步数 ${this.moveCount}。`;
    },
    clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    },
    isPieceDragging(piece) {
      return Boolean(this.dragging && this.dragging.clusterPiecesSet.has(piece.id));
    },
    setDragOffset(dx, dy) {
      this.dragOffset = { dx, dy };
      const boardEl = this.$refs.board;
      if (!boardEl) {
        return;
      }
      boardEl.style.setProperty('--drag-x', `${dx}px`);
      boardEl.style.setProperty('--drag-y', `${dy}px`);
    }
  }
}).mount('#app');
