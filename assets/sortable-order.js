(function(global) {
  function getPoint(event) {
    if (event.touches && event.touches[0]) return event.touches[0];
    if (event.changedTouches && event.changedTouches[0]) return event.changedTouches[0];
    return event;
  }

  function SortableOrder(container, options) {
    this.container = container;
    this.options = options || {};
    this.selector = this.options.selector || '[data-sort-id]';
    this.handleSelector = this.options.handleSelector || null;
    this.holdDelay = this.options.holdDelay || 180;
    this.dragging = null;
    this.dragClone = null;
    this.placeholder = null;
    this.pointerId = null;
    this.pressTimer = null;
    this.startX = 0;
    this.startY = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.didMove = false;
    this.justDraggedUntil = 0;
    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundClickCapture = this.onClickCapture.bind(this);
    this.init();
  }

  SortableOrder.prototype.init = function() {
    this.destroy();
    this.container.addEventListener('pointerdown', this.boundPointerDown);
    this.container.addEventListener('click', this.boundClickCapture, true);
    this.refresh();
  };

  SortableOrder.prototype.destroy = function() {
    this.container.removeEventListener('pointerdown', this.boundPointerDown);
    this.container.removeEventListener('click', this.boundClickCapture, true);
    this.cleanup();
  };

  SortableOrder.prototype.refresh = function() {
    var items = this.getItems();
    items.forEach(function(item) {
      item.style.touchAction = 'none';
    });
  };

  SortableOrder.prototype.getItems = function() {
    return Array.prototype.slice.call(this.container.querySelectorAll(this.selector))
      .filter(function(item) { return item.parentNode === this.container; }, this);
  };

  SortableOrder.prototype.findItem = function(target) {
    while (target && target !== this.container) {
      if (target.matches && target.matches(this.selector)) return target;
      target = target.parentNode;
    }
    return null;
  };

  SortableOrder.prototype.onClickCapture = function(event) {
    if (Date.now() < this.justDraggedUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  SortableOrder.prototype.onPointerDown = function(event) {
    if (event.button !== undefined && event.button !== 0) return;
    var target = event.target;
    if (this.handleSelector && !target.closest(this.handleSelector)) return;
    var item = this.findItem(target);
    if (!item) return;

    var point = getPoint(event);
    this.pointerId = event.pointerId;
    this.dragging = item;
    this.startX = point.clientX;
    this.startY = point.clientY;
    this.didMove = false;

    var rect = item.getBoundingClientRect();
    this.offsetX = this.startX - rect.left;
    this.offsetY = this.startY - rect.top;

    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);
    this.boundPointerCancel = this.onPointerCancel.bind(this);

    this.pressTimer = setTimeout(this.startDrag.bind(this), this.holdDelay);
    window.addEventListener('pointermove', this.boundPointerMove, { passive: false });
    window.addEventListener('pointerup', this.boundPointerUp, { passive: false });
    window.addEventListener('pointercancel', this.boundPointerCancel, { passive: false });
  };

  SortableOrder.prototype.onPointerMove = function(event) {
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    var point = getPoint(event);
    var dx = point.clientX - this.startX;
    var dy = point.clientY - this.startY;

    if (!this.placeholder && Math.abs(dx) + Math.abs(dy) > 8) {
      clearTimeout(this.pressTimer);
      this.startDrag();
    }
    if (!this.placeholder) return;

    event.preventDefault();
    this.didMove = true;
    this.positionClone(point.clientX, point.clientY);
    this.reorderByPoint(point.clientX, point.clientY);
  };

  SortableOrder.prototype.startDrag = function() {
    clearTimeout(this.pressTimer);
    if (!this.dragging || this.placeholder) return;

    var item = this.dragging;
    var rect = item.getBoundingClientRect();
    this.placeholder = document.createElement(item.tagName === 'TR' ? 'tr' : 'div');
    this.placeholder.className = (this.options.placeholderClass || 'sort-placeholder');
    this.placeholder.style.height = rect.height + 'px';
    if (item.tagName === 'TR') {
      var td = document.createElement('td');
      td.colSpan = item.children.length || 1;
      this.placeholder.appendChild(td);
    }

    item.classList.add(this.options.dragClass || 'is-sorting');
    item.parentNode.insertBefore(this.placeholder, item.nextSibling);

    this.dragClone = item.cloneNode(true);
    this.dragClone.classList.add(this.options.dragGhostClass || 'sort-ghost');
    this.dragClone.style.position = 'fixed';
    this.dragClone.style.left = rect.left + 'px';
    this.dragClone.style.top = rect.top + 'px';
    this.dragClone.style.width = rect.width + 'px';
    this.dragClone.style.height = rect.height + 'px';
    this.dragClone.style.pointerEvents = 'none';
    this.dragClone.style.zIndex = '9999';
    document.body.appendChild(this.dragClone);

    item.style.display = 'none';
    document.body.classList.add(this.options.bodyClass || 'sort-body-active');
  };

  SortableOrder.prototype.positionClone = function(clientX, clientY) {
    if (!this.dragClone) return;
    this.dragClone.style.left = (clientX - this.offsetX) + 'px';
    this.dragClone.style.top = (clientY - this.offsetY) + 'px';
  };

  SortableOrder.prototype.reorderByPoint = function(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    if (!el) return;
    var over = this.findItem(el);
    if (!over || over === this.dragging) return;
    var rect = over.getBoundingClientRect();
    var before = clientY < rect.top + rect.height / 2;
    if (before) this.container.insertBefore(this.placeholder, over);
    else this.container.insertBefore(this.placeholder, over.nextSibling);
  };

  SortableOrder.prototype.onPointerUp = function(event) {
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    clearTimeout(this.pressTimer);
    var moved = !!this.placeholder && this.didMove;
    if (this.placeholder && this.dragging) {
      this.container.insertBefore(this.dragging, this.placeholder);
      this.dragging.style.display = '';
      this.dragging.classList.remove(this.options.dragClass || 'is-sorting');
    }
    this.cleanup();
    if (moved) {
      this.justDraggedUntil = Date.now() + 250;
      if (typeof this.options.onReorder === 'function') {
        this.options.onReorder(this.getItems().map(function(item) {
          return item.getAttribute('data-sort-id');
        }));
      }
    }
  };

  SortableOrder.prototype.onPointerCancel = function(event) {
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    clearTimeout(this.pressTimer);
    if (this.placeholder && this.dragging) {
      this.container.insertBefore(this.dragging, this.placeholder);
      this.dragging.style.display = '';
      this.dragging.classList.remove(this.options.dragClass || 'is-sorting');
    }
    this.cleanup();
  };

  SortableOrder.prototype.cleanup = function() {
    clearTimeout(this.pressTimer);
    this.pressTimer = null;
    this.pointerId = null;
    if (this.placeholder && this.placeholder.parentNode) this.placeholder.parentNode.removeChild(this.placeholder);
    if (this.dragClone && this.dragClone.parentNode) this.dragClone.parentNode.removeChild(this.dragClone);
    if (this.dragging) {
      this.dragging.style.display = '';
      this.dragging.classList.remove(this.options.dragClass || 'is-sorting');
    }
    this.placeholder = null;
    this.dragClone = null;
    this.dragging = null;
    this.didMove = false;
    document.body.classList.remove(this.options.bodyClass || 'sort-body-active');
    if (this.boundPointerMove) window.removeEventListener('pointermove', this.boundPointerMove);
    if (this.boundPointerUp) window.removeEventListener('pointerup', this.boundPointerUp);
    if (this.boundPointerCancel) window.removeEventListener('pointercancel', this.boundPointerCancel);
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundPointerCancel = null;
  };

  global.SortableOrder = SortableOrder;
})(window);
