import { createApp } from './node_modules/vue/dist/vue.esm-browser.prod.js';
import * as PIXI from './node_modules/pixi.js/dist/pixi.min.mjs';

const builtInImages = [
  {
    id: 'liuying',
    name: '流萤',
    src: 'assets/liuying.png'
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
    
    // 确保页面元素可见
    this.$nextTick(() => {
      const appElement = document.getElementById('app');
      if (appElement) {
        appElement.style.opacity = '1';
        appElement.style.visibility = 'visible';
        appElement.style.position = 'static';
        appElement.style.left = 'auto';
        appElement.style.top = 'auto';
      }
    });
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
      this.pixiPieces = new Map();
      this.pixiLabels = new Map();
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
        startX: event.global.x,
        startY: event.global.y,
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
      this.renderPiecePositions();
    },
    handlePointerMove(event) {
      if (!this.dragging) {
        return;
      }
      event.preventDefault();
      this.pendingDrag = {
        dx: event.global.x - this.dragging.startX,
        dy: event.global.y - this.dragging.startY
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
        this.renderPiecePositions();
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
        // 目标位置是空白，直接移动聚类到该位置
        const originPiece = this.pieces[pieceId];
        const offsetRow = targetRow - originPiece.currentRow;
        const offsetCol = targetCol - originPiece.currentCol;

        const clusterA = Array.from(this.clusters.get(clusterId));

        // 计算新位置
        const newPositionsA = clusterA.map((id) => ({
          id,
          row: this.pieces[id].currentRow + offsetRow,
          col: this.pieces[id].currentCol + offsetCol
        }));

        // 检查新位置是否有效（在边界内且不与其他聚类冲突）
        const occupied = new Set();
        this.pieces.forEach((piece) => {
          if (piece.clusterId !== clusterId) {
            occupied.add(`${piece.currentRow},${piece.currentCol}`);
          }
        });

        const validMove = newPositionsA.every(pos => {
          if (pos.row < 0 || pos.row >= this.rows || pos.col < 0 || pos.col >= this.cols) {
            return false;
          }
          const key = `${pos.row},${pos.col}`;
          if (occupied.has(key)) {
            return false;
          }
          return true;
        });

        if (validMove) {
          // 清除原位置
          clusterA.forEach(id => {
            const piece = this.pieces[id];
            this.grid[piece.currentRow][piece.currentCol] = null;
          });

          // 设置新位置
          newPositionsA.forEach(pos => {
            const piece = this.pieces[pos.id];
            piece.currentRow = pos.row;
            piece.currentCol = pos.col;
            this.grid[pos.row][pos.col] = piece.id;
          });

          this.layoutPieces();
          this.updateMoveCount(this.moveCount + 1);

          // 检查受影响区域周围的聚类
          const affectedPositions = new Set();
          newPositionsA.forEach(pos => {
            // 添加当前位置及其邻居位置
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue; // 跳过自身
                const r = pos.row + dr;
                const c = pos.col + dc;
                if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
                  affectedPositions.add(`${r},${c}`);
                }
              }
            }
          });

          // 获取受影响位置的聚类ID
          const clustersToCheck = new Set();
          for (const posStr of affectedPositions) {
            const [r, c] = posStr.split(',').map(Number);
            const pieceId = this.grid[r][c];
            if (pieceId !== null) {
              clustersToCheck.add(this.pieces[pieceId].clusterId);
            }
          }

          this.checkAndMergeClusters(Array.from(clustersToCheck));
          this.checkWinCondition();

          this.dragging = null;
          this.renderPiecePositions();
        } else {
          // 如果无效移动，取消拖拽
          this.dragging = null;
          this.renderPiecePositions();
        }
        return;
      }

      const targetClusterId = this.pieces[targetPieceId].clusterId;
      if (targetClusterId === clusterId) {
        this.dragging = null;
        this.renderPiecePositions();
        return;
      }

      // 获取拖拽聚类的所有拼图块
      const clusterA = Array.from(this.clusters.get(clusterId));
      
      // 获取目标位置的拼图块所属的聚类
      const clusterB = Array.from(this.clusters.get(targetClusterId));
      
      // 获取移动的偏移量
      const originPiece = this.pieces[pieceId];
      const offsetRow = targetRow - originPiece.currentRow;
      const offsetCol = targetCol - originPiece.currentCol;

      // 检查是否可以进行简单的交换（传统逻辑）
      // 计算A组移动到目标位置后，B组应该移动到哪里
      const newPositionsA = clusterA.map((id) => ({
        id,
        row: this.pieces[id].currentRow + offsetRow,
        col: this.pieces[id].currentCol + offsetCol
      }));

      // B组移动到A组相对于原始位置的相反偏移处
      const newPositionsB = clusterB.map((id) => ({
        id,
        row: this.pieces[id].currentRow - offsetRow,
        col: this.pieces[id].currentCol - offsetCol
      }));

      // 检查目标位置是否被其他聚类占用
      const occupied = new Set();
      this.pieces.forEach((piece) => {
        if (piece.clusterId !== clusterId && piece.clusterId !== targetClusterId) {
          occupied.add(`${piece.currentRow},${piece.currentCol}`);
        }
      });

      const validMove = this.isPositionsValid(newPositionsA, newPositionsB, occupied);
      
      if (validMove) {
        // 如果满足交换条件，则执行交换逻辑
        this.updateClusterPositions(newPositionsA, newPositionsB);
        this.updateMoveCount(this.moveCount + 1);
        
        // 只检查受影响区域周围的聚类
        const affectedPositions = new Set();
        [...newPositionsA, ...newPositionsB].forEach(pos => {
          // 添加当前位置及其邻居位置
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue; // 跳过自身
              const r = pos.row + dr;
              const c = pos.col + dc;
              if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
                affectedPositions.add(`${r},${c}`);
              }
            }
          }
        });
        
        // 获取受影响位置的聚类ID
        const clustersToCheck = new Set();
        for (const posStr of affectedPositions) {
          const [r, c] = posStr.split(',').map(Number);
          const pieceId = this.grid[r][c];
          if (pieceId !== null) {
            clustersToCheck.add(this.pieces[pieceId].clusterId);
          }
        }
        
        this.checkAndMergeClusters(Array.from(clustersToCheck));
        this.checkWinCondition();

        this.dragging = null;
        this.renderPiecePositions();
      } else {
        // 如果不能简单交换，则执行"挤开"逻辑
        // 计算clusterA移动到新位置后会占据哪些格子
        const newPositionsForClusterA = [];
        const occupiedCells = new Set();
        
        for (const id of clusterA) {
          const piece = this.pieces[id];
          const newRow = piece.currentRow + offsetRow;
          const newCol = piece.currentCol + offsetCol;
          
          // 检查新位置是否在边界内
          if (newRow >= 0 && newRow < this.rows && newCol >= 0 && newCol < this.cols) {
            newPositionsForClusterA.push({
              id,
              row: newRow,
              col: newCol
            });
            occupiedCells.add(`${newRow},${newCol}`);
          } else {
            // 如果移动后超出边界，则取消移动
            this.dragging = null;
            this.renderPiecePositions();
            return;
          }
        }
        
        // 找出目标位置被clusterA占据的拼图块，这些拼图块需要被"挤开"
        const piecesToMove = [];
        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            const pieceIdAtPos = this.grid[r][c];
            if (pieceIdAtPos !== null) {
              // 如果这个位置在clusterA移动后会占据的空间内
              if (occupiedCells.has(`${r},${c}`)) {
                // 且不属于clusterA本身
                const piece = this.pieces[pieceIdAtPos];
                if (!clusterA.includes(pieceIdAtPos)) {
                  piecesToMove.push({
                    id: pieceIdAtPos,
                    fromRow: r,
                    fromCol: c
                  });
                }
              }
            }
          }
        }
        
        // 计算被挤开的拼图块的新位置（移动到原来clusterA的位置）
        const newPositionsForPiecesToMove = [];
        for (const pieceToMove of piecesToMove) {
          const originalPiece = this.pieces[pieceToMove.id];
          // 将被挤开的拼图块移动到原来clusterA位置的对应位置
          // 即从新位置回到原来的位置
          const originalRow = originalPiece.currentRow - offsetRow;
          const originalCol = originalPiece.currentCol - offsetCol;
          
          if (originalRow >= 0 && originalRow < this.rows && originalCol >= 0 && originalCol < this.cols) {
            // 检查目标位置是否被其他被挤开的拼图块占据
            const isOccupied = newPositionsForPiecesToMove.some(pos => 
              pos.row === originalRow && pos.col === originalCol
            );
            
            if (!isOccupied) {
              // 检查是否被其他不动的拼图块占据
              const isOccupiedByOther = occupied.has(`${originalRow},${originalCol}`);
              if (!isOccupiedByOther) {
                newPositionsForPiecesToMove.push({
                  id: pieceToMove.id,
                  row: originalRow,
                  col: originalCol
                });
              } else {
                // 如果目标位置被其他拼图块占据，尝试寻找附近的空位
                let foundNewSpot = false;
                for (let dr = -2; dr <= 2 && !foundNewSpot; dr++) {
                  for (let dc = -2; dc <= 2 && !foundNewSpot; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    
                    const tryRow = originalRow + dr;
                    const tryCol = originalCol + dc;
                    
                    if (tryRow >= 0 && tryRow < this.rows && tryCol >= 0 && tryCol < this.cols) {
                      const isSpotOccupied = newPositionsForPiecesToMove.some(pos => 
                        pos.row === tryRow && pos.col === tryCol
                      ) || occupied.has(`${tryRow},${tryCol}`);
                      
                      if (!isSpotOccupied) {
                        // 确认新位置不与clusterA的新位置冲突
                        const isSpotOccupiedByClusterA = newPositionsForClusterA.some(pos => 
                          pos.row === tryRow && pos.col === tryCol
                        );
                        
                        if (!isSpotOccupiedByClusterA) {
                          newPositionsForPiecesToMove.push({
                            id: pieceToMove.id,
                            row: tryRow,
                            col: tryCol
                          });
                          foundNewSpot = true;
                        }
                      }
                    }
                  }
                }
                
                // 如果仍然找不到位置，就取消移动
                if (!foundNewSpot) {
                  this.dragging = null;
                  this.renderPiecePositions();
                  return;
                }
              }
            } else {
              // 如果目标位置已被其他被挤开的拼图块占据，寻找附近的空位
              let foundNewSpot = false;
              for (let dr = -2; dr <= 2 && !foundNewSpot; dr++) {
                for (let dc = -2; dc <= 2 && !foundNewSpot; dc++) {
                  if (dr === 0 && dc === 0) continue;
                  
                  const tryRow = originalRow + dr;
                  const tryCol = originalCol + dc;
                  
                  if (tryRow >= 0 && tryRow < this.rows && tryCol >= 0 && tryCol < this.cols) {
                    const isSpotOccupied = newPositionsForPiecesToMove.some(pos => 
                      pos.row === tryRow && pos.col === tryCol
                    ) || occupied.has(`${tryRow},${tryCol}`);
                    
                    if (!isSpotOccupied) {
                      // 确认新位置不与clusterA的新位置冲突
                      const isSpotOccupiedByClusterA = newPositionsForClusterA.some(pos => 
                        pos.row === tryRow && pos.col === tryCol
                      );
                      
                      if (!isSpotOccupiedByClusterA) {
                        newPositionsForPiecesToMove.push({
                          id: pieceToMove.id,
                          row: tryRow,
                          col: tryCol
                        });
                        foundNewSpot = true;
                      }
                    }
                  }
                }
              }
              
              // 如果仍然找不到位置，就取消移动
              if (!foundNewSpot) {
                this.dragging = null;
                this.renderPiecePositions();
                return;
              }
            }
          } else {
            // 如果新位置超出边界，取消移动
            this.dragging = null;
            this.renderPiecePositions();
            return;
          }
        }

        // 检查目标位置是否被其他未被挤开的聚类占用
        const occupiedAfterMove = new Set();
        this.pieces.forEach((piece) => {
          // 排除即将移动的拼图块
          const willMove = clusterA.includes(piece.id) || piecesToMove.some(p => p.id === piece.id);
          if (!willMove) {
            occupiedAfterMove.add(`${piece.currentRow},${piece.currentCol}`);
          }
        });

        // 检查新位置是否有效
        const allNewPositions = [...newPositionsForClusterA, ...newPositionsForPiecesToMove];
        const isValid = allNewPositions.every(pos => {
          if (pos.row < 0 || pos.row >= this.rows || pos.col < 0 || pos.col >= this.cols) {
            return false;
          }
          const key = `${pos.row},${pos.col}`;
          if (occupiedAfterMove.has(key)) {
            return false;
          }
          // 检查是否在新位置中有重叠
          const duplicate = allNewPositions.some(otherPos => 
            otherPos !== pos && otherPos.row === pos.row && otherPos.col === pos.col
          );
          if (duplicate) {
            return false;
          }
          return true;
        });

        if (!isValid) {
          this.dragging = null;
          this.renderPiecePositions();
          return;
        }

        // 执行移动
        // 先清除原位置
        clusterA.forEach(id => {
          const piece = this.pieces[id];
          this.grid[piece.currentRow][piece.currentCol] = null;
        });
        
        piecesToMove.forEach(piece => {
          const pieceObj = this.pieces[piece.id];
          this.grid[pieceObj.currentRow][pieceObj.currentCol] = null;
        });

        // 设置新位置
        newPositionsForClusterA.forEach(pos => {
          const piece = this.pieces[pos.id];
          piece.currentRow = pos.row;
          piece.currentCol = pos.col;
          this.grid[pos.row][pos.col] = piece.id;
        });
        
        newPositionsForPiecesToMove.forEach(pos => {
          const piece = this.pieces[pos.id];
          piece.currentRow = pos.row;
          piece.currentCol = pos.col;
          this.grid[pos.row][pos.col] = piece.id;
        });

        this.layoutPieces();
        this.updateMoveCount(this.moveCount + 1);
        
        // 只检查受影响区域周围的聚类
        const affectedPositionsForPushAside = new Set();
        allNewPositions.forEach(pos => {
          // 添加当前位置及其邻居位置
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue; // 跳过自身
              const r = pos.row + dr;
              const c = pos.col + dc;
              if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
                affectedPositionsForPushAside.add(`${r},${c}`);
              }
            }
          }
        });
        
        // 获取受影响位置的聚类ID
        const clustersToCheckForPushAside = new Set();
        for (const posStr of affectedPositionsForPushAside) {
          const [r, c] = posStr.split(',').map(Number);
          const pieceId = this.grid[r][c];
          if (pieceId !== null) {
            clustersToCheckForPushAside.add(this.pieces[pieceId].clusterId);
          }
        }
        
        this.checkAndMergeClusters(Array.from(clustersToCheckForPushAside));
        this.checkWinCondition();

        this.dragging = null;
        this.renderPiecePositions();
      }
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
      // 先清除原来位置的网格引用
      newPositionsA.forEach((pos) => {
        const piece = this.pieces[pos.id];
        if (piece.currentRow >= 0 && piece.currentRow < this.rows && 
            piece.currentCol >= 0 && piece.currentCol < this.cols) {
          this.grid[piece.currentRow][piece.currentCol] = null;
        }
      });
      newPositionsB.forEach((pos) => {
        const piece = this.pieces[pos.id];
        if (piece.currentRow >= 0 && piece.currentRow < this.rows && 
            piece.currentCol >= 0 && piece.currentCol < this.cols) {
          this.grid[piece.currentRow][piece.currentCol] = null;
        }
      });

      // 设置新的位置
      newPositionsA.forEach((pos) => {
        const piece = this.pieces[pos.id];
        piece.currentRow = pos.row;
        piece.currentCol = pos.col;
        if (pos.row >= 0 && pos.row < this.rows && 
            pos.col >= 0 && pos.col < this.cols) {
          this.grid[pos.row][pos.col] = piece.id;
        }
      });

      newPositionsB.forEach((pos) => {
        const piece = this.pieces[pos.id];
        piece.currentRow = pos.row;
        piece.currentCol = pos.col;
        if (pos.row >= 0 && pos.row < this.rows && 
            pos.col >= 0 && pos.col < this.cols) {
          this.grid[pos.row][pos.col] = piece.id;
        }
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
      this.renderPiecePositions();
      this.$nextTick(() => {
        pieceIds.forEach((id) => {
          const piece = this.pieces[id];
          piece.flashActive = true;
          if (piece.flashTimer) {
            clearTimeout(piece.flashTimer);
          }
          piece.flashTimer = setTimeout(() => {
            piece.flashActive = false;
            this.renderPiecePositions();
          }, 450);
        });
        this.renderPiecePositions();
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
    },
    async loadPixiTexture(dataUrl) {
      if (!dataUrl) {
        return;
      }
      this.initPixi();
      if (this.baseTexture) {
        this.baseTexture.destroy();
        this.baseTexture = null;
      }
      const baseTexture = PIXI.BaseTexture.from(dataUrl);
      await new Promise((resolve, reject) => {
        if (baseTexture.valid) {
          resolve();
          return;
        }
        baseTexture.once('loaded', resolve);
        baseTexture.once('error', reject);
      });
      this.baseTexture = baseTexture;
    },
    prepareTexture() {
      if (!this.baseTexture) {
        return;
      }
    },
    createPixiPieces() {
      if (!this.pixiContainer || !this.baseTexture) {
        return;
      }
      this.clearPixiPieces();
      const tileWidth = this.baseTexture.width / this.cols;
      const tileHeight = this.baseTexture.height / this.rows;

      this.pieces.forEach((piece) => {
        const rect = new PIXI.Rectangle(
          piece.correctCol * tileWidth,
          piece.correctRow * tileHeight,
          tileWidth,
          tileHeight
        );
        const texture = new PIXI.Texture(this.baseTexture, rect);
        const sprite = new PIXI.Sprite(texture);
        sprite.__pieceId = piece.id;
        sprite.eventMode = 'static';
        sprite.cursor = 'pointer';
        sprite.on('pointerdown', (event) => this.handlePointerDown(event));

        const label = new PIXI.Text(String(piece.id + 1), {
          fontFamily: '"Segoe UI", "Noto Sans", "PingFang SC", sans-serif',
          fontSize: 12,
          fill: 0xffffff,
          stroke: 0x1a1e3e,
          strokeThickness: 3
        });
        label.x = 6;
        label.y = 4;
        label.visible = this.showNumbers;
        label.eventMode = 'none';
        sprite.addChild(label);

        this.pixiContainer.addChild(sprite);
        this.pixiPieces.set(piece.id, sprite);
        this.pixiLabels.set(piece.id, label);
      });
    },
    renderPiecePositions() {
      if (!this.pixiPieces || !this.pixiPieces.size) {
        return;
      }
      const activeCluster = this.dragging ? this.dragging.clusterPiecesSet : null;
      this.pieces.forEach((piece) => {
        const sprite = this.pixiPieces.get(piece.id);
        if (!sprite) {
          return;
        }
        const isDragging = activeCluster ? activeCluster.has(piece.id) : false;
        const offsetX = isDragging && this.dragging ? this.dragging.dx : 0;
        const offsetY = isDragging && this.dragging ? this.dragging.dy : 0;
        sprite.x = piece.currentCol * this.pieceSize + offsetX;
        sprite.y = piece.currentRow * this.pieceSize + offsetY;
        sprite.width = this.pieceSize;
        sprite.height = this.pieceSize;
        sprite.zIndex = isDragging ? 1000 : 1;
        sprite.alpha = piece.flashActive ? 0.9 : 1;
      });
      if (this.pixiContainer) {
        this.pixiContainer.sortChildren();
      }
    },
    updateLabelVisibility() {
      if (!this.pixiLabels) {
        return;
      }
      this.pixiLabels.forEach((label) => {
        label.visible = this.showNumbers;
      });
    }
  }
}).mount('#app');
