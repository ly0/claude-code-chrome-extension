/**
 * GIF Encoder Library
 * Based on gif.js (https://github.com/jnordberg/gif.js)
 *
 * This is a minimal implementation for browser use.
 * For production, consider using the full gif.js library.
 */

(function(root) {
  'use strict';

  class GIF {
    constructor(options = {}) {
      this.options = {
        workers: options.workers || 2,
        quality: options.quality || 10,
        width: options.width || 0,
        height: options.height || 0,
        workerScript: options.workerScript || null,
        background: options.background || '#fff',
        transparent: options.transparent || null,
        dither: options.dither !== false,
        debug: options.debug || false
      };

      this.frames = [];
      this.freeWorkers = [];
      this.activeWorkers = [];
      this.running = false;
      this.listeners = {};
    }

    on(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
    }

    emit(event, data) {
      const callbacks = this.listeners[event] || [];
      for (const callback of callbacks) {
        callback(data);
      }
    }

    addFrame(image, options = {}) {
      const frame = {
        delay: options.delay || 100,
        copy: options.copy !== false,
        dispose: options.dispose || -1,
        transparent: this.options.transparent
      };

      if (image instanceof HTMLCanvasElement) {
        frame.data = image.getContext('2d').getImageData(
          0, 0, image.width, image.height
        ).data;
        frame.width = image.width;
        frame.height = image.height;
      } else if (image instanceof ImageData) {
        frame.data = image.data;
        frame.width = image.width;
        frame.height = image.height;
      } else {
        throw new Error('Unsupported image type');
      }

      // Update dimensions if not set
      if (!this.options.width) this.options.width = frame.width;
      if (!this.options.height) this.options.height = frame.height;

      this.frames.push(frame);
    }

    render() {
      if (this.running) {
        throw new Error('Already rendering');
      }

      this.running = true;

      // Simple synchronous render (for demo purposes)
      // Production should use Web Workers
      try {
        const blob = this._encode();
        this.emit('finished', blob);
      } catch (error) {
        this.emit('error', error);
      }

      this.running = false;
    }

    _encode() {
      const encoder = new GIFEncoder(this.options.width, this.options.height);
      encoder.setRepeat(0); // Loop forever
      encoder.setQuality(this.options.quality);

      if (this.options.transparent !== null) {
        encoder.setTransparent(this.options.transparent);
      }

      encoder.start();

      for (const frame of this.frames) {
        encoder.setDelay(frame.delay);
        encoder.addFrame(frame.data, frame.width, frame.height);
      }

      encoder.finish();

      return new Blob([encoder.stream().getData()], { type: 'image/gif' });
    }
  }

  /**
   * Minimal GIF Encoder
   */
  class GIFEncoder {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.transparent = null;
      this.repeat = 0;
      this.delay = 100;
      this.quality = 10;
      this.out = new ByteArray();
      this.started = false;
      this.firstFrame = true;
    }

    setDelay(ms) {
      this.delay = Math.round(ms / 10);
    }

    setRepeat(repeat) {
      this.repeat = repeat;
    }

    setTransparent(color) {
      this.transparent = color;
    }

    setQuality(quality) {
      this.quality = Math.max(1, Math.min(30, quality));
    }

    start() {
      this.out.writeUTFBytes('GIF89a');
      this.started = true;
    }

    addFrame(data, width, height) {
      if (!this.started) {
        throw new Error('GIF not started');
      }

      width = width || this.width;
      height = height || this.height;

      // Build color table
      const colorTab = this._analyzePixels(data, width, height);

      if (this.firstFrame) {
        this._writeLSD(width, height);
        this._writePalette(colorTab);
        if (this.repeat >= 0) {
          this._writeNetscapeExt();
        }
      }

      this._writeGraphicCtrlExt();
      this._writeImageDesc(width, height, !this.firstFrame);

      if (!this.firstFrame) {
        this._writePalette(colorTab);
      }

      this._writePixels(data, colorTab, width, height);
      this.firstFrame = false;
    }

    finish() {
      this.out.writeByte(0x3B); // GIF trailer
    }

    stream() {
      return this.out;
    }

    _analyzePixels(data, width, height) {
      // Simple color quantization - use most common colors
      const colorMap = new Map();

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const key = (r << 16) | (g << 8) | b;

        colorMap.set(key, (colorMap.get(key) || 0) + 1);
      }

      // Sort by frequency and take top 256 colors
      const sorted = [...colorMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 256);

      const colorTab = new Uint8Array(256 * 3);
      for (let i = 0; i < sorted.length; i++) {
        const color = sorted[i][0];
        colorTab[i * 3] = (color >> 16) & 0xFF;
        colorTab[i * 3 + 1] = (color >> 8) & 0xFF;
        colorTab[i * 3 + 2] = color & 0xFF;
      }

      this.colorTab = colorTab;
      this.colorMap = new Map(sorted.map(([color], i) => [color, i]));

      return colorTab;
    }

    _writeLSD(width, height) {
      this.out.writeShort(width);
      this.out.writeShort(height);

      // Packed field: global color table flag (1), color resolution (7),
      // sort flag (0), size of global color table (7)
      this.out.writeByte(0xF7);
      this.out.writeByte(0); // Background color index
      this.out.writeByte(0); // Pixel aspect ratio
    }

    _writePalette(colorTab) {
      this.out.writeBytes(colorTab);
      const remaining = 256 * 3 - colorTab.length;
      for (let i = 0; i < remaining; i++) {
        this.out.writeByte(0);
      }
    }

    _writeNetscapeExt() {
      this.out.writeByte(0x21); // Extension
      this.out.writeByte(0xFF); // Application extension
      this.out.writeByte(11);   // Block size
      this.out.writeUTFBytes('NETSCAPE2.0');
      this.out.writeByte(3);    // Sub-block size
      this.out.writeByte(1);    // Loop sub-block ID
      this.out.writeShort(this.repeat); // Loop count
      this.out.writeByte(0);    // Block terminator
    }

    _writeGraphicCtrlExt() {
      this.out.writeByte(0x21); // Extension
      this.out.writeByte(0xF9); // Graphic control
      this.out.writeByte(4);    // Block size

      let packed = 0;
      if (this.transparent !== null) {
        packed |= 1; // Transparent flag
      }
      packed |= 0 << 2; // Disposal method (none)

      this.out.writeByte(packed);
      this.out.writeShort(this.delay);
      this.out.writeByte(this.transparent !== null ? this.transparent : 0);
      this.out.writeByte(0); // Block terminator
    }

    _writeImageDesc(width, height, useLocalColorTable) {
      this.out.writeByte(0x2C); // Image separator
      this.out.writeShort(0);   // Left
      this.out.writeShort(0);   // Top
      this.out.writeShort(width);
      this.out.writeShort(height);

      if (useLocalColorTable) {
        this.out.writeByte(0x87); // Local color table, 256 colors
      } else {
        this.out.writeByte(0);    // No local color table
      }
    }

    _writePixels(data, colorTab, width, height) {
      const pixels = new Uint8Array(width * height);

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const key = (r << 16) | (g << 8) | b;

        pixels[i / 4] = this.colorMap.get(key) || 0;
      }

      // LZW encode
      const encoder = new LZWEncoder(width, height, pixels, 8);
      encoder.encode(this.out);
    }
  }

  /**
   * LZW Encoder
   */
  class LZWEncoder {
    constructor(width, height, pixels, colorDepth) {
      this.width = width;
      this.height = height;
      this.pixels = pixels;
      this.colorDepth = Math.max(2, colorDepth);
      this.initCodeSize = this.colorDepth;
    }

    encode(out) {
      out.writeByte(this.initCodeSize);

      const clearCode = 1 << this.initCodeSize;
      const eofCode = clearCode + 1;
      let nextCode = eofCode + 1;
      let codeSize = this.initCodeSize + 1;
      let maxCode = (1 << codeSize) - 1;

      let curCode = this.pixels[0];
      const accum = new ByteArray();
      let bits = 0;
      let buf = 0;

      const output = (code) => {
        buf |= (code << bits);
        bits += codeSize;
        while (bits >= 8) {
          accum.writeByte(buf & 0xFF);
          buf >>= 8;
          bits -= 8;
        }
      };

      const table = new Map();
      output(clearCode);

      for (let i = 1; i < this.pixels.length; i++) {
        const nextPixel = this.pixels[i];
        const key = (curCode << 12) | nextPixel;

        if (table.has(key)) {
          curCode = table.get(key);
        } else {
          output(curCode);
          if (nextCode <= 4095) {
            table.set(key, nextCode++);
            if (nextCode > maxCode && codeSize < 12) {
              codeSize++;
              maxCode = (1 << codeSize) - 1;
            }
          } else {
            output(clearCode);
            table.clear();
            nextCode = eofCode + 1;
            codeSize = this.initCodeSize + 1;
            maxCode = (1 << codeSize) - 1;
          }
          curCode = nextPixel;
        }
      }

      output(curCode);
      output(eofCode);

      if (bits > 0) {
        accum.writeByte(buf & 0xFF);
      }

      // Write sub-blocks
      const data = accum.getData();
      for (let i = 0; i < data.length; i += 255) {
        const chunk = Math.min(255, data.length - i);
        out.writeByte(chunk);
        for (let j = 0; j < chunk; j++) {
          out.writeByte(data[i + j]);
        }
      }

      out.writeByte(0); // Block terminator
    }
  }

  /**
   * Byte Array helper
   */
  class ByteArray {
    constructor() {
      this.data = [];
    }

    writeByte(b) {
      this.data.push(b & 0xFF);
    }

    writeShort(s) {
      this.writeByte(s & 0xFF);
      this.writeByte((s >> 8) & 0xFF);
    }

    writeBytes(bytes) {
      for (let i = 0; i < bytes.length; i++) {
        this.writeByte(bytes[i]);
      }
    }

    writeUTFBytes(str) {
      for (let i = 0; i < str.length; i++) {
        this.writeByte(str.charCodeAt(i));
      }
    }

    getData() {
      return new Uint8Array(this.data);
    }
  }

  // Export
  root.GIF = GIF;

})(typeof window !== 'undefined' ? window : this);
