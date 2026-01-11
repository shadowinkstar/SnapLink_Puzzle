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

const boardEl = document.getElementById('board');
const builtInSelect = document.getElementById('builtInSelect');
const uploadInput = document.getElementById('uploadInput');
const gridSelect = document.getElementById('gridSelect');
const numberToggle = document.getElementById('numberToggle');
const cropToggle = document.getElementById('cropToggle');
const shuffleButton = document.getElementById('shuffleButton');
const imagePreview = document.getElementById('imagePreview');
const moveCountEl = document.getElementById('moveCount');
const timeElapsedEl = document.getElementById('timeElapsed');
const winModal = document.getElementById('winModal');
const winStats = document.getElementById('winStats');
const playAgainButton = document.getElementById('playAgainButton');
const closeModalButton = document.getElementById('closeModalButton');

const state = {
  rows: 6,
  cols: 6,
  pieces: [],
  clusters: new Map(),
  grid: [],
  imageDataUrl: '',
  moveCount: 0,
  startTime: null,
  timerId: null,
  dragging: null,
  boardSize: 0,
  pieceSize: 0,
  isComplete: false
};

function init() {
  builtInImages.forEach((image) => {
    const option = document.createElement('option');
    option.value = image.id;
    option.textContent = image.name;
    builtInSelect.appendChild(option);
  });

  builtInSelect.addEventListener('change', () => {
    const selected = builtInImages.find((image) => image.id === builtInSelect.value);
    if (selected) {
      loadBuiltIn(selected);
    }
  });

  uploadInput.addEventListener('change', handleUpload);
  gridSelect.addEventListener('change', () => {
    const size = Number.parseInt(gridSelect.value, 10);
    state.rows = size;
    state.cols = size;
    resetGame();
  });

  numberToggle.addEventListener('change', () => {
    updateNumberVisibility();
  });

  cropToggle.addEventListener('change', () => {
    if (uploadInput.files && uploadInput.files[0]) {
      handleUpload();
    } else {
      resetGame();
    }
  });

  shuffleButton.addEventListener('click', () => {
    shufflePieces();
    updateMoveCount(0);
    resetTimer();
  });

  playAgainButton.addEventListener('click', () => {
    hideWinModal();
    shufflePieces();
    updateMoveCount(0);
    resetTimer();
  });

  closeModalButton.addEventListener('click', () => {
    hideWinModal();
  });

  window.addEventListener('resize', () => {
    updateBoardMetrics();
    layoutPieces();
  });

  boardEl.addEventListener('pointerdown', handlePointerDown);
  boardEl.addEventListener('pointermove', handlePointerMove);
  boardEl.addEventListener('pointerup', handlePointerUp);
  boardEl.addEventListener('pointerleave', handlePointerUp);

  builtInSelect.value = builtInImages[0].id;
  loadBuiltIn(builtInImages[0]);
}

async function loadBuiltIn(image) {
  const response = await fetch(image.src);
  const blob = await response.blob();
  const bitmap = await loadBitmap(blob);
  await setImageFromBitmap(bitmap);
}

async function handleUpload() {
  const file = uploadInput.files && uploadInput.files[0];
  if (!file) {
    return;
  }
  const bitmap = await loadBitmap(file);
  await setImageFromBitmap(bitmap);
}

async function loadBitmap(source) {
  if ('createImageBitmap' in window) {
    return createImageBitmap(source, { imageOrientation: 'from-image' });
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(source);
  });
}

async function setImageFromBitmap(bitmap) {
  const dataUrl = renderImage(bitmap, cropToggle.checked);
  state.imageDataUrl = dataUrl;
  imagePreview.src = dataUrl;
  resetGame();
}

function renderImage(bitmap, cropSquare) {
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
}

function resetGame() {
  clearBoard();
  buildPieces();
  shufflePieces();
  updateMoveCount(0);
  resetTimer();
}

function clearBoard() {
  boardEl.innerHTML = '';
  state.pieces = [];
  state.clusters.clear();
  state.grid = [];
  state.isComplete = false;
}

function buildPieces() {
  updateBoardMetrics();
  const total = state.rows * state.cols;
  state.grid = Array.from({ length: state.rows }, () => Array(state.cols).fill(null));

  for (let i = 0; i < total; i += 1) {
    const correctRow = Math.floor(i / state.cols);
    const correctCol = i % state.cols;
    const piece = {
      id: i,
      correctRow,
      correctCol,
      currentRow: correctRow,
      currentCol: correctCol,
      clusterId: i,
      el: document.createElement('div')
    };

    piece.el.className = 'piece';
    piece.el.dataset.id = String(piece.id);
    piece.el.innerHTML = `<span class="piece-label">${correctRow + 1},${correctCol + 1}</span>`;
    piece.el.style.width = `${state.pieceSize}px`;
    piece.el.style.height = `${state.pieceSize}px`;
    boardEl.appendChild(piece.el);

    state.pieces.push(piece);
    state.clusters.set(piece.clusterId, new Set([piece.id]));
  }

  layoutPieces();
  updateNumberVisibility();
}

function updateBoardMetrics() {
  const rect = boardEl.getBoundingClientRect();
  state.boardSize = rect.width;
  state.pieceSize = rect.width / state.cols;
}

function layoutPieces() {
  state.pieces.forEach((piece) => {
    piece.el.style.width = `${state.pieceSize}px`;
    piece.el.style.height = `${state.pieceSize}px`;
    piece.el.style.left = `${piece.currentCol * state.pieceSize}px`;
    piece.el.style.top = `${piece.currentRow * state.pieceSize}px`;
    piece.el.style.backgroundImage = `url(${state.imageDataUrl})`;
    piece.el.style.backgroundSize = `${state.boardSize}px ${state.boardSize}px`;
    piece.el.style.backgroundPosition = `-${piece.correctCol * state.pieceSize}px -${piece.correctRow * state.pieceSize}px`;
  });
}

function updateNumberVisibility() {
  state.pieces.forEach((piece) => {
    piece.el.classList.toggle('show-label', numberToggle.checked);
  });
}

function shufflePieces() {
  const total = state.rows * state.cols;
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
    const row = Math.floor(cellIndex / state.cols);
    const col = cellIndex % state.cols;
    const piece = state.pieces[pieceId];
    piece.currentRow = row;
    piece.currentCol = col;
    piece.clusterId = piece.id;
  });

  state.clusters.clear();
  state.pieces.forEach((piece) => {
    state.clusters.set(piece.clusterId, new Set([piece.id]));
  });

  state.grid = Array.from({ length: state.rows }, () => Array(state.cols).fill(null));
  state.pieces.forEach((piece) => {
    state.grid[piece.currentRow][piece.currentCol] = piece.id;
  });

  layoutPieces();
  state.isComplete = false;
}

function updateMoveCount(value) {
  state.moveCount = value;
  moveCountEl.textContent = String(value);
}

function resetTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
  }
  state.startTime = Date.now();
  updateTimer();
  state.timerId = setInterval(updateTimer, 1000);
}

function updateTimer() {
  if (!state.startTime) {
    return;
  }
  const elapsedSeconds = Math.floor((Date.now() - state.startTime) / 1000);
  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
  const seconds = String(elapsedSeconds % 60).padStart(2, '0');
  timeElapsedEl.textContent = `${minutes}:${seconds}`;
}

function handlePointerDown(event) {
  const target = event.target.closest('.piece');
  if (!target || state.isComplete) {
    return;
  }
  event.preventDefault();
  target.setPointerCapture(event.pointerId);

  const pieceId = Number.parseInt(target.dataset.id, 10);
  const piece = state.pieces[pieceId];
  const clusterPieces = Array.from(state.clusters.get(piece.clusterId));

  state.dragging = {
    clusterId: piece.clusterId,
    pieceId,
    startX: event.clientX,
    startY: event.clientY,
    clusterPieces,
    originalPositions: clusterPieces.map((id) => ({
      id,
      row: state.pieces[id].currentRow,
      col: state.pieces[id].currentCol
    }))
  };

  clusterPieces.forEach((id) => {
    state.pieces[id].el.classList.add('dragging');
  });
}

function handlePointerMove(event) {
  if (!state.dragging) {
    return;
  }
  event.preventDefault();
  const dx = event.clientX - state.dragging.startX;
  const dy = event.clientY - state.dragging.startY;

  state.dragging.clusterPieces.forEach((id) => {
    const pieceEl = state.pieces[id].el;
    pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;
  });
}

function handlePointerUp(event) {
  if (!state.dragging) {
    return;
  }

  const { clusterId, pieceId, clusterPieces } = state.dragging;
  clusterPieces.forEach((id) => {
    const pieceEl = state.pieces[id].el;
    pieceEl.classList.remove('dragging');
    pieceEl.style.transform = '';
  });

  const boardRect = boardEl.getBoundingClientRect();
  const x = event.clientX - boardRect.left;
  const y = event.clientY - boardRect.top;
  const targetRow = clamp(Math.floor(y / state.pieceSize), 0, state.rows - 1);
  const targetCol = clamp(Math.floor(x / state.pieceSize), 0, state.cols - 1);
  const targetPieceId = state.grid[targetRow][targetCol];

  if (targetPieceId == null) {
    state.dragging = null;
    return;
  }

  const targetClusterId = state.pieces[targetPieceId].clusterId;
  if (targetClusterId === clusterId) {
    state.dragging = null;
    return;
  }

  const originPiece = state.pieces[pieceId];
  const offsetRow = targetRow - originPiece.currentRow;
  const offsetCol = targetCol - originPiece.currentCol;

  const clusterA = Array.from(state.clusters.get(clusterId));
  const clusterB = Array.from(state.clusters.get(targetClusterId));

  const occupied = new Set();
  state.pieces.forEach((piece) => {
    if (piece.clusterId !== clusterId && piece.clusterId !== targetClusterId) {
      occupied.add(`${piece.currentRow},${piece.currentCol}`);
    }
  });

  const newPositionsA = clusterA.map((id) => ({
    id,
    row: state.pieces[id].currentRow + offsetRow,
    col: state.pieces[id].currentCol + offsetCol
  }));

  const newPositionsB = clusterB.map((id) => ({
    id,
    row: state.pieces[id].currentRow - offsetRow,
    col: state.pieces[id].currentCol - offsetCol
  }));

  const validMove = isPositionsValid(newPositionsA, newPositionsB, occupied);
  if (!validMove) {
    state.dragging = null;
    return;
  }

  updateClusterPositions(newPositionsA, newPositionsB);
  updateMoveCount(state.moveCount + 1);
  checkAndMergeClusters([clusterId, targetClusterId]);
  checkWinCondition();

  if (event.target && event.target.releasePointerCapture) {
    event.target.releasePointerCapture(event.pointerId);
  }
  state.dragging = null;
}

function isPositionsValid(newPositionsA, newPositionsB, occupied) {
  const allPositions = new Set();
  const checkPositions = (positions) => positions.every((pos) => {
    if (pos.row < 0 || pos.row >= state.rows || pos.col < 0 || pos.col >= state.cols) {
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
}

function updateClusterPositions(newPositionsA, newPositionsB) {
  newPositionsA.forEach((pos) => {
    const piece = state.pieces[pos.id];
    state.grid[piece.currentRow][piece.currentCol] = null;
  });
  newPositionsB.forEach((pos) => {
    const piece = state.pieces[pos.id];
    state.grid[piece.currentRow][piece.currentCol] = null;
  });

  newPositionsA.forEach((pos) => {
    const piece = state.pieces[pos.id];
    piece.currentRow = pos.row;
    piece.currentCol = pos.col;
    state.grid[pos.row][pos.col] = piece.id;
  });

  newPositionsB.forEach((pos) => {
    const piece = state.pieces[pos.id];
    piece.currentRow = pos.row;
    piece.currentCol = pos.col;
    state.grid[pos.row][pos.col] = piece.id;
  });

  layoutPieces();
}

function checkAndMergeClusters(clusterIds) {
  let merged = true;
  while (merged) {
    merged = false;
    clusterIds.forEach((clusterId) => {
      const pieceIds = Array.from(state.clusters.get(clusterId) || []);
      pieceIds.forEach((pieceId) => {
        const piece = state.pieces[pieceId];
        const neighbors = [
          { row: piece.currentRow - 1, col: piece.currentCol, dr: -1, dc: 0 },
          { row: piece.currentRow + 1, col: piece.currentCol, dr: 1, dc: 0 },
          { row: piece.currentRow, col: piece.currentCol - 1, dr: 0, dc: -1 },
          { row: piece.currentRow, col: piece.currentCol + 1, dr: 0, dc: 1 }
        ];

        neighbors.forEach((neighbor) => {
          if (neighbor.row < 0 || neighbor.row >= state.rows || neighbor.col < 0 || neighbor.col >= state.cols) {
            return;
          }
          const neighborId = state.grid[neighbor.row][neighbor.col];
          if (neighborId == null) {
            return;
          }
          const neighborPiece = state.pieces[neighborId];
          if (piece.clusterId === neighborPiece.clusterId) {
            return;
          }

          const correctNeighborRow = piece.correctRow + neighbor.dr;
          const correctNeighborCol = piece.correctCol + neighbor.dc;
          const isCorrectNeighbor = neighborPiece.correctRow === correctNeighborRow && neighborPiece.correctCol === correctNeighborCol;

          if (isCorrectNeighbor) {
            mergeClusters(piece.clusterId, neighborPiece.clusterId);
            flashCluster(piece.clusterId);
            merged = true;
          }
        });
      });
    });
  }
}

function mergeClusters(targetClusterId, sourceClusterId) {
  if (targetClusterId === sourceClusterId) {
    return;
  }
  const targetSet = state.clusters.get(targetClusterId);
  const sourceSet = state.clusters.get(sourceClusterId);
  if (!targetSet || !sourceSet) {
    return;
  }
  sourceSet.forEach((id) => {
    targetSet.add(id);
    state.pieces[id].clusterId = targetClusterId;
  });
  state.clusters.delete(sourceClusterId);
}

function flashCluster(clusterId) {
  const pieceIds = Array.from(state.clusters.get(clusterId) || []);
  pieceIds.forEach((id) => {
    const pieceEl = state.pieces[id].el;
    pieceEl.classList.remove('merge-flash');
    void pieceEl.offsetWidth;
    pieceEl.classList.add('merge-flash');
  });
}

function checkWinCondition() {
  const allCorrect = state.pieces.every((piece) => piece.currentRow === piece.correctRow && piece.currentCol === piece.correctCol);
  if (!allCorrect) {
    return;
  }
  state.isComplete = true;
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  showWinModal();
}

function showWinModal() {
  winModal.classList.add('show');
  winModal.setAttribute('aria-hidden', 'false');
  winStats.textContent = `用时 ${timeElapsedEl.textContent}，步数 ${state.moveCount}。`;
}

function hideWinModal() {
  winModal.classList.remove('show');
  winModal.setAttribute('aria-hidden', 'true');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

init();
