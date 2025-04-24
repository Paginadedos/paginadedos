document.addEventListener('DOMContentLoaded', function() {
    // Referencias a elementos del DOM
    const canvas = document.getElementById('drawing-board');
    const ctx = canvas.getContext('2d');
    const colorPicker = document.getElementById('color-picker');
    const brushSize = document.getElementById('brush-size');
    const eraserBtn = document.getElementById('eraser');
    const eraserSize = document.getElementById('eraser-size');
    const textToolBtn = document.getElementById('text-tool');
    const textSize = document.getElementById('text-size');
    const clearBtn = document.getElementById('clear');
    const canvasContainer = document.querySelector('.canvas-container');

    // Configuración inicial
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentColor = '#000000';
    let currentSize = 5;
    let isEraser = false;
    let isTextMode = false;
    let textInput = null;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    // Configurar el tamaño del canvas (muy grande para permitir desplazamiento)
    const canvasWidth = 5000;
    const canvasHeight = 5000;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Centrar el canvas inicialmente
    offsetX = (canvasContainer.clientWidth - canvasWidth) / 2;
    offsetY = (canvasContainer.clientHeight - canvasHeight) / 2;
    updateCanvasPosition();

    // Configurar Firebase para comunicación en tiempo real
    // Acceder a Firebase desde las variables globales expuestas en index.html
    const database = window.firebaseDatabase;
    const { ref, set, onValue, push, remove } = window.firebaseRefs;
    
    // Crear una referencia a la sala de dibujo (puedes tener múltiples salas)
    const roomId = 'sala-principal';
    const drawingsRef = ref(database, 'drawings/' + roomId);
    const textsRef = ref(database, 'texts/' + roomId);
    const clearRef = ref(database, 'clear/' + roomId);
    
    // Generar un ID único para este usuario
    const userId = 'user_' + Math.random().toString(36).substr(2, 9);
    
    // Objeto para manejar la comunicación con Firebase
    const firebaseHandler = {
        // Enviar un trazo de dibujo a Firebase
        emitDraw: function(data) {
            const drawingRef = push(ref(database, 'drawings/' + roomId));
            set(drawingRef, {
                ...data,
                userId: userId,
                timestamp: Date.now()
            });
        },
        
        // Enviar un texto a Firebase
        emitText: function(data) {
            const textRef = push(ref(database, 'texts/' + roomId));
            set(textRef, {
                ...data,
                userId: userId,
                timestamp: Date.now()
            });
        },
        
        // Enviar una señal de limpieza a Firebase
        emitClear: function() {
            set(clearRef, {
                userId: userId,
                timestamp: Date.now()
            });
        },
        
        // Callbacks para manejar eventos
        onDraw: null,
        onText: null,
        onClear: null
    };
    
    // Escuchar nuevos trazos de dibujo
    onValue(drawingsRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        
        // Procesar solo el último trazo añadido
        const keys = Object.keys(data);
        const lastKey = keys[keys.length - 1];
        const drawData = data[lastKey];
        
        // Evitar procesar nuestros propios trazos
        if (drawData.userId === userId) return;
        
        // Llamar al callback si existe
        if (firebaseHandler.onDraw) {
            firebaseHandler.onDraw(drawData);
        } else {
            // Si el callback no está configurado, dibujar directamente
            drawLine(
                drawData.x0 * canvasWidth, 
                drawData.y0 * canvasHeight, 
                drawData.x1 * canvasWidth, 
                drawData.y1 * canvasHeight, 
                drawData.color, 
                drawData.size,
                true // skipEmit para evitar bucles infinitos
            );
        }
    });
    
    // Escuchar nuevos textos
    onValue(textsRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        
        // Procesar solo el último texto añadido
        const keys = Object.keys(data);
        const lastKey = keys[keys.length - 1];
        const textData = data[lastKey];
        
        // Evitar procesar nuestros propios textos
        if (textData.userId === userId) return;
        
        // Llamar al callback si existe
        if (firebaseHandler.onText) {
            firebaseHandler.onText(textData);
        } else {
            // Si el callback no está configurado, añadir texto directamente
            addTextToCanvas(
                textData.x * canvasWidth,
                textData.y * canvasHeight,
                textData.text,
                textData.size,
                textData.color,
                true // skipEmit para evitar bucles infinitos
            );
        }
    });
    
    // Escuchar señales de limpieza
    onValue(clearRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        
        // Evitar procesar nuestras propias señales de limpieza
        if (data.userId === userId) return;
        
        // Llamar al callback si existe
        if (firebaseHandler.onClear) {
            firebaseHandler.onClear();
        } else {
            // Si el callback no está configurado, limpiar directamente
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    });
    
    // Método para registrar callbacks
    firebaseHandler.on = function(event, callback) {
        if (event === 'draw') this.onDraw = callback;
        else if (event === 'text') this.onText = callback;
        else if (event === 'clear') this.onClear = callback;
    };
    
    // Usar firebaseHandler en lugar de socket
    const socket = firebaseHandler;

    // Función para actualizar la posición del canvas
    function updateCanvasPosition() {
        canvas.style.transform = `scale(${scale})`;
        canvas.style.left = `${offsetX}px`;
        canvas.style.top = `${offsetY}px`;
    }

    // Función para convertir coordenadas del cliente a coordenadas del canvas
    function getCanvasCoordinates(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left) / scale,
            y: (clientY - rect.top) / scale
        };
    }

    // Función para dibujar una línea
    function drawLine(x0, y0, x1, y1, color, size, skipEmit) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.stroke();

        if (!skipEmit) {
            // Enviar datos normalizados (0-1) para que sean independientes del tamaño del canvas
            socket.emitDraw({
                x0: x0 / canvasWidth,
                y0: y0 / canvasHeight,
                x1: x1 / canvasWidth,
                y1: y1 / canvasHeight,
                color: color,
                size: size
            });
        }
    }

    // Función para añadir texto al canvas
    function addTextToCanvas(x, y, text, size, color, skipEmit) {
        ctx.font = `${size}px Arial`;
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);

        if (!skipEmit) {
            socket.emitText({
                x: x / canvasWidth,
                y: y / canvasHeight,
                text: text,
                size: size,
                color: color
            });
        }
    }

    // Eventos de mouse para dibujar
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // Eventos táctiles para dispositivos móviles
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', handleTouchEnd);

    // Eventos para desplazamiento del canvas (cuando no se está dibujando)
    canvasContainer.addEventListener('mousedown', startDragging);
    canvasContainer.addEventListener('mousemove', drag);
    canvasContainer.addEventListener('mouseup', stopDragging);
    canvasContainer.addEventListener('touchstart', startDraggingTouch);
    canvasContainer.addEventListener('touchmove', dragTouch);
    canvasContainer.addEventListener('touchend', stopDraggingTouch);

    // Evento de rueda para zoom
    canvasContainer.addEventListener('wheel', handleZoom);

    // Función para iniciar el dibujo
    function startDrawing(e) {
        if (isTextMode) return;
        
        isDrawing = true;
        const coords = getCanvasCoordinates(e.clientX, e.clientY);
        lastX = coords.x;
        lastY = coords.y;

        // Evitar desplazamiento mientras se dibuja
        e.preventDefault();
    }

    // Función para dibujar
    function draw(e) {
        if (!isDrawing) return;
        
        const coords = getCanvasCoordinates(e.clientX, e.clientY);
        const currentX = coords.x;
        const currentY = coords.y;
        
        drawLine(
            lastX, 
            lastY, 
            currentX, 
            currentY, 
            isEraser ? '#FFFFFF' : currentColor, 
            isEraser ? parseInt(eraserSize.value) : parseInt(brushSize.value)
        );
        
        lastX = currentX;
        lastY = currentY;

        // Evitar desplazamiento mientras se dibuja
        e.preventDefault();
    }

    // Función para detener el dibujo
    function stopDrawing() {
        isDrawing = false;
    }

    // Funciones para manejo táctil
    function handleTouchStart(e) {
        if (isTextMode) return;
        
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        canvas.dispatchEvent(mouseEvent);
        e.preventDefault();
    }

    function handleTouchMove(e) {
        if (!isDrawing) return;
        
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousemove', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        canvas.dispatchEvent(mouseEvent);
        e.preventDefault();
    }

    function handleTouchEnd(e) {
        const mouseEvent = new MouseEvent('mouseup');
        canvas.dispatchEvent(mouseEvent);
        e.preventDefault();
    }

    // Funciones para desplazamiento del canvas
    function startDragging(e) {
        if (isDrawing || isTextMode) return;
        
        isDragging = true;
        dragStartX = e.clientX - offsetX;
        dragStartY = e.clientY - offsetY;
        canvasContainer.style.cursor = 'grabbing';
    }

    function drag(e) {
        if (!isDragging) return;
        
        offsetX = e.clientX - dragStartX;
        offsetY = e.clientY - dragStartY;
        updateCanvasPosition();
    }

    function stopDragging() {
        isDragging = false;
        canvasContainer.style.cursor = 'grab';
    }

    // Funciones para desplazamiento táctil del canvas
    function startDraggingTouch(e) {
        if (isDrawing || isTextMode || e.target === canvas) return;
        
        const touch = e.touches[0];
        isDragging = true;
        dragStartX = touch.clientX - offsetX;
        dragStartY = touch.clientY - offsetY;
    }

    function dragTouch(e) {
        if (!isDragging) return;
        
        const touch = e.touches[0];
        offsetX = touch.clientX - dragStartX;
        offsetY = touch.clientY - dragStartY;
        updateCanvasPosition();
        e.preventDefault();
    }

    function stopDraggingTouch() {
        isDragging = false;
    }

    // Función para manejar el zoom
    function handleZoom(e) {
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newScale = Math.max(0.5, Math.min(3, scale + delta));
        
        // Ajustar el offset para hacer zoom hacia el cursor
        const rect = canvasContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        offsetX = mouseX - (mouseX - offsetX) * (newScale / scale);
        offsetY = mouseY - (mouseY - offsetY) * (newScale / scale);
        
        scale = newScale;
        updateCanvasPosition();
    }

    // Evento para cambiar color
    colorPicker.addEventListener('input', function() {
        currentColor = this.value;
        isEraser = false;
    });

    // Evento para el borrador
    eraserBtn.addEventListener('click', function() {
        isEraser = !isEraser;
        this.textContent = isEraser ? 'Volver a Pincel' : 'Borrador';
        if (isTextMode) toggleTextMode();
    });

    // Evento para la herramienta de texto
    textToolBtn.addEventListener('click', toggleTextMode);

    function toggleTextMode() {
        isTextMode = !isTextMode;
        textToolBtn.textContent = isTextMode ? 'Cancelar Texto' : 'Añadir Texto';
        isEraser = false;
        eraserBtn.textContent = 'Borrador';
        
        if (!isTextMode && textInput) {
            document.body.removeChild(textInput);
            textInput = null;
        }
        
        canvas.style.cursor = isTextMode ? 'text' : 'crosshair';
    }

    // Evento para añadir texto al hacer clic en el canvas
    canvas.addEventListener('click', function(e) {
        if (!isTextMode) return;
        
        const coords = getCanvasCoordinates(e.clientX, e.clientY);
        
        // Crear un input para el texto
        if (textInput) {
            document.body.removeChild(textInput);
        }
        
        textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'text-input';
        textInput.style.left = `${e.clientX}px`;
        textInput.style.top = `${e.clientY}px`;
        textInput.style.fontSize = `${textSize.value}px`;
        document.body.appendChild(textInput);
        textInput.focus();
        
        // Añadir el texto al canvas cuando se presiona Enter
        textInput.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && this.value.trim() !== '') {
                addTextToCanvas(
                    coords.x, 
                    coords.y, 
                    this.value, 
                    parseInt(textSize.value), 
                    currentColor
                );
                document.body.removeChild(this);
                textInput = null;
            }
        });
        
        // También añadir el texto si se hace clic fuera del input
        textInput.addEventListener('blur', function() {
            if (this.value.trim() !== '') {
                addTextToCanvas(
                    coords.x, 
                    coords.y, 
                    this.value, 
                    parseInt(textSize.value), 
                    currentColor
                );
            }
            document.body.removeChild(this);
            textInput = null;
        });
    });

    // Evento para limpiar el canvas
    clearBtn.addEventListener('click', function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emitClear();
    });

    // Ajustar el cursor según el modo
    canvas.style.cursor = 'crosshair';
    canvasContainer.style.cursor = 'grab';
});
