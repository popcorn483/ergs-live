/* QR code encoder: QRCode for JavaScript, Copyright (c) 2009 Kazuhiko Arase, MIT licence (via qrcode-terminal). Bundled for ERGS. */
window.ERGSQR = (function(){ var M = {}, C = {}; function req(n){ n = n.replace('./', ''); if (!(n in C)){ var m = {exports:{}}; C[n] = m.exports; M[n](m, m.exports); C[n] = m.exports; } return C[n]; }
M['QR8bitByte'] = function(module, exports){ var require = req;
var QRMode = require('./QRMode');

function QR8bitByte(data) {
	this.mode = QRMode.MODE_8BIT_BYTE;
	this.data = data;
}

QR8bitByte.prototype = {

	getLength : function() {
		return this.data.length;
	},
	
	write : function(buffer) {
		for (var i = 0; i < this.data.length; i++) {
			// not JIS ...
			buffer.put(this.data.charCodeAt(i), 8);
		}
	}
};

module.exports = QR8bitByte;

};
M['QRBitBuffer'] = function(module, exports){ var require = req;
function QRBitBuffer() {
	this.buffer = [];
	this.length = 0;
}

QRBitBuffer.prototype = {

	get : function(index) {
		var bufIndex = Math.floor(index / 8);
		return ( (this.buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
	},
	
	put : function(num, length) {
		for (var i = 0; i < length; i++) {
			this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
		}
	},
	
	getLengthInBits : function() {
		return this.length;
	},
	
	putBit : function(bit) {
	
		var bufIndex = Math.floor(this.length / 8);
		if (this.buffer.length <= bufIndex) {
			this.buffer.push(0);
		}
	
		if (bit) {
			this.buffer[bufIndex] |= (0x80 >>> (this.length % 8) );
		}
	
		this.length++;
	}
};

module.exports = QRBitBuffer;

};
M['QRErrorCorrectLevel'] = function(module, exports){ var require = req;
module.exports = {
	L : 1,
	M : 0,
	Q : 3,
	H : 2
};


};
M['QRMaskPattern'] = function(module, exports){ var require = req;
module.exports = {
	PATTERN000 : 0,
	PATTERN001 : 1,
	PATTERN010 : 2,
	PATTERN011 : 3,
	PATTERN100 : 4,
	PATTERN101 : 5,
	PATTERN110 : 6,
	PATTERN111 : 7
};

};
M['QRMath'] = function(module, exports){ var require = req;
var QRMath = {

	glog : function(n) {
	
		if (n < 1) {
			throw new Error("glog(" + n + ")");
		}
		
		return QRMath.LOG_TABLE[n];
	},
	
	gexp : function(n) {
	
		while (n < 0) {
			n += 255;
		}
	
		while (n >= 256) {
			n -= 255;
		}
	
		return QRMath.EXP_TABLE[n];
	},
	
	EXP_TABLE : new Array(256),
	
	LOG_TABLE : new Array(256)

};
	
for (var i = 0; i < 8; i++) {
	QRMath.EXP_TABLE[i] = 1 << i;
}
for (var i = 8; i < 256; i++) {
	QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4]
		^ QRMath.EXP_TABLE[i - 5]
		^ QRMath.EXP_TABLE[i - 6]
		^ QRMath.EXP_TABLE[i - 8];
}
for (var i = 0; i < 255; i++) {
	QRMath.LOG_TABLE[QRMath.EXP_TABLE[i] ] = i;
}

module.exports = QRMath;

};
M['QRMode'] = function(module, exports){ var require = req;
module.exports = {
    MODE_NUMBER :       1 << 0,
    MODE_ALPHA_NUM :    1 << 1,
    MODE_8BIT_BYTE :    1 << 2,
    MODE_KANJI :        1 << 3
};

};
M['QRPolynomial'] = function(module, exports){ var require = req;
var QRMath = require('./QRMath');

function QRPolynomial(num, shift) {
	if (num.length === undefined) {
		throw new Error(num.length + "/" + shift);
	}

	var offset = 0;

	while (offset < num.length && num[offset] === 0) {
		offset++;
	}

	this.num = new Array(num.length - offset + shift);
	for (var i = 0; i < num.length - offset; i++) {
		this.num[i] = num[i + offset];
	}
}

QRPolynomial.prototype = {

	get : function(index) {
		return this.num[index];
	},
	
	getLength : function() {
		return this.num.length;
	},
	
	multiply : function(e) {
	
		var num = new Array(this.getLength() + e.getLength() - 1);
	
		for (var i = 0; i < this.getLength(); i++) {
			for (var j = 0; j < e.getLength(); j++) {
				num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i) ) + QRMath.glog(e.get(j) ) );
			}
		}
	
		return new QRPolynomial(num, 0);
	},
	
	mod : function(e) {
	
		if (this.getLength() - e.getLength() < 0) {
			return this;
		}
	
		var ratio = QRMath.glog(this.get(0) ) - QRMath.glog(e.get(0) );
	
		var num = new Array(this.getLength() );
		
		for (var i = 0; i < this.getLength(); i++) {
			num[i] = this.get(i);
		}
		
		for (var x = 0; x < e.getLength(); x++) {
			num[x] ^= QRMath.gexp(QRMath.glog(e.get(x) ) + ratio);
		}
	
		// recursive call
		return new QRPolynomial(num, 0).mod(e);
	}
};

module.exports = QRPolynomial;

};
M['QRRSBlock'] = function(module, exports){ var require = req;
var QRErrorCorrectLevel = require('./QRErrorCorrectLevel');

function QRRSBlock(totalCount, dataCount) {
	this.totalCount = totalCount;
	this.dataCount  = dataCount;
}

QRRSBlock.RS_BLOCK_TABLE = [

	// L
	// M
	// Q
	// H

	// 1
	[1, 26, 19],
	[1, 26, 16],
	[1, 26, 13],
	[1, 26, 9],
	
	// 2
	[1, 44, 34],
	[1, 44, 28],
	[1, 44, 22],
	[1, 44, 16],

	// 3
	[1, 70, 55],
	[1, 70, 44],
	[2, 35, 17],
	[2, 35, 13],

	// 4		
	[1, 100, 80],
	[2, 50, 32],
	[2, 50, 24],
	[4, 25, 9],
	
	// 5
	[1, 134, 108],
	[2, 67, 43],
	[2, 33, 15, 2, 34, 16],
	[2, 33, 11, 2, 34, 12],
	
	// 6
	[2, 86, 68],
	[4, 43, 27],
	[4, 43, 19],
	[4, 43, 15],
	
	// 7		
	[2, 98, 78],
	[4, 49, 31],
	[2, 32, 14, 4, 33, 15],
	[4, 39, 13, 1, 40, 14],
	
	// 8
	[2, 121, 97],
	[2, 60, 38, 2, 61, 39],
	[4, 40, 18, 2, 41, 19],
	[4, 40, 14, 2, 41, 15],
	
	// 9
	[2, 146, 116],
	[3, 58, 36, 2, 59, 37],
	[4, 36, 16, 4, 37, 17],
	[4, 36, 12, 4, 37, 13],
	
	// 10		
	[2, 86, 68, 2, 87, 69],
	[4, 69, 43, 1, 70, 44],
	[6, 43, 19, 2, 44, 20],
	[6, 43, 15, 2, 44, 16],

	// 11
	[4, 101, 81],
	[1, 80, 50, 4, 81, 51],
	[4, 50, 22, 4, 51, 23],
	[3, 36, 12, 8, 37, 13],

	// 12
	[2, 116, 92, 2, 117, 93],
	[6, 58, 36, 2, 59, 37],
	[4, 46, 20, 6, 47, 21],
	[7, 42, 14, 4, 43, 15],

	// 13
	[4, 133, 107],
	[8, 59, 37, 1, 60, 38],
	[8, 44, 20, 4, 45, 21],
	[12, 33, 11, 4, 34, 12],

	// 14
	[3, 145, 115, 1, 146, 116],
	[4, 64, 40, 5, 65, 41],
	[11, 36, 16, 5, 37, 17],
	[11, 36, 12, 5, 37, 13],

	// 15
	[5, 109, 87, 1, 110, 88],
	[5, 65, 41, 5, 66, 42],
	[5, 54, 24, 7, 55, 25],
	[11, 36, 12],

	// 16
	[5, 122, 98, 1, 123, 99],
	[7, 73, 45, 3, 74, 46],
	[15, 43, 19, 2, 44, 20],
	[3, 45, 15, 13, 46, 16],

	// 17
	[1, 135, 107, 5, 136, 108],
	[10, 74, 46, 1, 75, 47],
	[1, 50, 22, 15, 51, 23],
	[2, 42, 14, 17, 43, 15],

	// 18
	[5, 150, 120, 1, 151, 121],
	[9, 69, 43, 4, 70, 44],
	[17, 50, 22, 1, 51, 23],
	[2, 42, 14, 19, 43, 15],

	// 19
	[3, 141, 113, 4, 142, 114],
	[3, 70, 44, 11, 71, 45],
	[17, 47, 21, 4, 48, 22],
	[9, 39, 13, 16, 40, 14],

	// 20
	[3, 135, 107, 5, 136, 108],
	[3, 67, 41, 13, 68, 42],
	[15, 54, 24, 5, 55, 25],
	[15, 43, 15, 10, 44, 16],

	// 21
	[4, 144, 116, 4, 145, 117],
	[17, 68, 42],
	[17, 50, 22, 6, 51, 23],
	[19, 46, 16, 6, 47, 17],

	// 22
	[2, 139, 111, 7, 140, 112],
	[17, 74, 46],
	[7, 54, 24, 16, 55, 25],
	[34, 37, 13],

	// 23
	[4, 151, 121, 5, 152, 122],
	[4, 75, 47, 14, 76, 48],
	[11, 54, 24, 14, 55, 25],
	[16, 45, 15, 14, 46, 16],

	// 24
	[6, 147, 117, 4, 148, 118],
	[6, 73, 45, 14, 74, 46],
	[11, 54, 24, 16, 55, 25],
	[30, 46, 16, 2, 47, 17],

	// 25
	[8, 132, 106, 4, 133, 107],
	[8, 75, 47, 13, 76, 48],
	[7, 54, 24, 22, 55, 25],
	[22, 45, 15, 13, 46, 16],

	// 26
	[10, 142, 114, 2, 143, 115],
	[19, 74, 46, 4, 75, 47],
	[28, 50, 22, 6, 51, 23],
	[33, 46, 16, 4, 47, 17],

	// 27
	[8, 152, 122, 4, 153, 123],
	[22, 73, 45, 3, 74, 46],
	[8, 53, 23, 26, 54, 24],
	[12, 45, 15, 28, 46, 16],

	// 28
	[3, 147, 117, 10, 148, 118],
	[3, 73, 45, 23, 74, 46],
	[4, 54, 24, 31, 55, 25],
	[11, 45, 15, 31, 46, 16],

	// 29
	[7, 146, 116, 7, 147, 117],
	[21, 73, 45, 7, 74, 46],
	[1, 53, 23, 37, 54, 24],
	[19, 45, 15, 26, 46, 16],

	// 30
	[5, 145, 115, 10, 146, 116],
	[19, 75, 47, 10, 76, 48],
	[15, 54, 24, 25, 55, 25],
	[23, 45, 15, 25, 46, 16],

	// 31
	[13, 145, 115, 3, 146, 116],
	[2, 74, 46, 29, 75, 47],
	[42, 54, 24, 1, 55, 25],
	[23, 45, 15, 28, 46, 16],

	// 32
	[17, 145, 115],
	[10, 74, 46, 23, 75, 47],
	[10, 54, 24, 35, 55, 25],
	[19, 45, 15, 35, 46, 16],

	// 33
	[17, 145, 115, 1, 146, 116],
	[14, 74, 46, 21, 75, 47],
	[29, 54, 24, 19, 55, 25],
	[11, 45, 15, 46, 46, 16],

	// 34
	[13, 145, 115, 6, 146, 116],
	[14, 74, 46, 23, 75, 47],
	[44, 54, 24, 7, 55, 25],
	[59, 46, 16, 1, 47, 17],

	// 35
	[12, 151, 121, 7, 152, 122],
	[12, 75, 47, 26, 76, 48],
	[39, 54, 24, 14, 55, 25],
	[22, 45, 15, 41, 46, 16],

	// 36
	[6, 151, 121, 14, 152, 122],
	[6, 75, 47, 34, 76, 48],
	[46, 54, 24, 10, 55, 25],
	[2, 45, 15, 64, 46, 16],

	// 37
	[17, 152, 122, 4, 153, 123],
	[29, 74, 46, 14, 75, 47],
	[49, 54, 24, 10, 55, 25],
	[24, 45, 15, 46, 46, 16],

	// 38
	[4, 152, 122, 18, 153, 123],
	[13, 74, 46, 32, 75, 47],
	[48, 54, 24, 14, 55, 25],
	[42, 45, 15, 32, 46, 16],

	// 39
	[20, 147, 117, 4, 148, 118],
	[40, 75, 47, 7, 76, 48],
	[43, 54, 24, 22, 55, 25],
	[10, 45, 15, 67, 46, 16],

	// 40
	[19, 148, 118, 6, 149, 119],
	[18, 75, 47, 31, 76, 48],
	[34, 54, 24, 34, 55, 25],
	[20, 45, 15, 61, 46, 16]
];

QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
	
	var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
	
	if (rsBlock === undefined) {
		throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
	}

	var length = rsBlock.length / 3;
	
	var list = [];
	
	for (var i = 0; i < length; i++) {

		var count = rsBlock[i * 3 + 0];
		var totalCount = rsBlock[i * 3 + 1];
		var dataCount  = rsBlock[i * 3 + 2];

		for (var j = 0; j < count; j++) {
			list.push(new QRRSBlock(totalCount, dataCount) );	
		}
	}
	
	return list;
};

QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {

	switch(errorCorrectLevel) {
	case QRErrorCorrectLevel.L :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
	case QRErrorCorrectLevel.M :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
	case QRErrorCorrectLevel.Q :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
	case QRErrorCorrectLevel.H :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
	default :
		return undefined;
	}
};

module.exports = QRRSBlock;

};
M['QRUtil'] = function(module, exports){ var require = req;
var QRMode = require('./QRMode');
var QRPolynomial = require('./QRPolynomial');
var QRMath = require('./QRMath');
var QRMaskPattern = require('./QRMaskPattern');

var QRUtil = {

    PATTERN_POSITION_TABLE : [
        [],
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
        [6, 30, 54],        
        [6, 32, 58],
        [6, 34, 62],
        [6, 26, 46, 66],
        [6, 26, 48, 70],
        [6, 26, 50, 74],
        [6, 30, 54, 78],
        [6, 30, 56, 82],
        [6, 30, 58, 86],
        [6, 34, 62, 90],
        [6, 28, 50, 72, 94],
        [6, 26, 50, 74, 98],
        [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106],
        [6, 32, 58, 84, 110],
        [6, 30, 58, 86, 114],
        [6, 34, 62, 90, 118],
        [6, 26, 50, 74, 98, 122],
        [6, 30, 54, 78, 102, 126],
        [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134],
        [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142],
        [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150],
        [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158],
        [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166],
        [6, 30, 58, 86, 114, 142, 170]
    ],

    G15 : (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
    G18 : (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
    G15_MASK : (1 << 14) | (1 << 12) | (1 << 10)    | (1 << 4) | (1 << 1),

    getBCHTypeInfo : function(data) {
        var d = data << 10;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
            d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) ) );    
        }
        return ( (data << 10) | d) ^ QRUtil.G15_MASK;
    },

    getBCHTypeNumber : function(data) {
        var d = data << 12;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
            d ^= (QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) ) );    
        }
        return (data << 12) | d;
    },

    getBCHDigit : function(data) {

        var digit = 0;

        while (data !== 0) {
            digit++;
            data >>>= 1;
        }

        return digit;
    },

    getPatternPosition : function(typeNumber) {
        return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
    },

    getMask : function(maskPattern, i, j) {
        
        switch (maskPattern) {
            
        case QRMaskPattern.PATTERN000 : return (i + j) % 2 === 0;
        case QRMaskPattern.PATTERN001 : return i % 2 === 0;
        case QRMaskPattern.PATTERN010 : return j % 3 === 0;
        case QRMaskPattern.PATTERN011 : return (i + j) % 3 === 0;
        case QRMaskPattern.PATTERN100 : return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 === 0;
        case QRMaskPattern.PATTERN101 : return (i * j) % 2 + (i * j) % 3 === 0;
        case QRMaskPattern.PATTERN110 : return ( (i * j) % 2 + (i * j) % 3) % 2 === 0;
        case QRMaskPattern.PATTERN111 : return ( (i * j) % 3 + (i + j) % 2) % 2 === 0;

        default :
            throw new Error("bad maskPattern:" + maskPattern);
        }
    },

    getErrorCorrectPolynomial : function(errorCorrectLength) {

        var a = new QRPolynomial([1], 0);

        for (var i = 0; i < errorCorrectLength; i++) {
            a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0) );
        }

        return a;
    },

    getLengthInBits : function(mode, type) {

        if (1 <= type && type < 10) {

            // 1 - 9

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 10;
            case QRMode.MODE_ALPHA_NUM  : return 9;
            case QRMode.MODE_8BIT_BYTE  : return 8;
            case QRMode.MODE_KANJI      : return 8;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 27) {

            // 10 - 26

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 12;
            case QRMode.MODE_ALPHA_NUM  : return 11;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 10;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 41) {

            // 27 - 40

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 14;
            case QRMode.MODE_ALPHA_NUM  : return 13;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 12;
            default :
                throw new Error("mode:" + mode);
            }

        } else {
            throw new Error("type:" + type);
        }
    },

    getLostPoint : function(qrCode) {
        
        var moduleCount = qrCode.getModuleCount();
        var lostPoint = 0;
        var row = 0; 
        var col = 0;

        
        // LEVEL1
        
        for (row = 0; row < moduleCount; row++) {

            for (col = 0; col < moduleCount; col++) {

                var sameCount = 0;
                var dark = qrCode.isDark(row, col);

                for (var r = -1; r <= 1; r++) {

                    if (row + r < 0 || moduleCount <= row + r) {
                        continue;
                    }

                    for (var c = -1; c <= 1; c++) {

                        if (col + c < 0 || moduleCount <= col + c) {
                            continue;
                        }

                        if (r === 0 && c === 0) {
                            continue;
                        }

                        if (dark === qrCode.isDark(row + r, col + c) ) {
                            sameCount++;
                        }
                    }
                }

                if (sameCount > 5) {
                    lostPoint += (3 + sameCount - 5);
                }
            }
        }

        // LEVEL2

        for (row = 0; row < moduleCount - 1; row++) {
            for (col = 0; col < moduleCount - 1; col++) {
                var count = 0;
                if (qrCode.isDark(row,     col    ) ) count++;
                if (qrCode.isDark(row + 1, col    ) ) count++;
                if (qrCode.isDark(row,     col + 1) ) count++;
                if (qrCode.isDark(row + 1, col + 1) ) count++;
                if (count === 0 || count === 4) {
                    lostPoint += 3;
                }
            }
        }

        // LEVEL3

        for (row = 0; row < moduleCount; row++) {
            for (col = 0; col < moduleCount - 6; col++) {
                if (qrCode.isDark(row, col) && 
                        !qrCode.isDark(row, col + 1) && 
                         qrCode.isDark(row, col + 2) && 
                         qrCode.isDark(row, col + 3) && 
                         qrCode.isDark(row, col + 4) && 
                        !qrCode.isDark(row, col + 5) && 
                         qrCode.isDark(row, col + 6) ) {
                    lostPoint += 40;
                }
            }
        }

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount - 6; row++) {
                if (qrCode.isDark(row, col) &&
                        !qrCode.isDark(row + 1, col) &&
                         qrCode.isDark(row + 2, col) &&
                         qrCode.isDark(row + 3, col) &&
                         qrCode.isDark(row + 4, col) &&
                        !qrCode.isDark(row + 5, col) &&
                         qrCode.isDark(row + 6, col) ) {
                    lostPoint += 40;
                }
            }
        }

        // LEVEL4
        
        var darkCount = 0;

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount; row++) {
                if (qrCode.isDark(row, col) ) {
                    darkCount++;
                }
            }
        }
        
        var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;

        return lostPoint;       
    }

};

module.exports = QRUtil;

};
M['index'] = function(module, exports){ var require = req;
//---------------------------------------------------------------------
// QRCode for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//   http://www.opensource.org/licenses/mit-license.php
//
// The word "QR Code" is registered trademark of 
// DENSO WAVE INCORPORATED
//   http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------
// Modified to work in node for this project (and some refactoring)
//---------------------------------------------------------------------

var QR8bitByte = require('./QR8bitByte');
var QRUtil = require('./QRUtil');
var QRPolynomial = require('./QRPolynomial');
var QRRSBlock = require('./QRRSBlock');
var QRBitBuffer = require('./QRBitBuffer');

function QRCode(typeNumber, errorCorrectLevel) {
	this.typeNumber = typeNumber;
	this.errorCorrectLevel = errorCorrectLevel;
	this.modules = null;
	this.moduleCount = 0;
	this.dataCache = null;
	this.dataList = [];
}

QRCode.prototype = {
	
	addData : function(data) {
		var newData = new QR8bitByte(data);
		this.dataList.push(newData);
		this.dataCache = null;
	},
	
	isDark : function(row, col) {
		if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
			throw new Error(row + "," + col);
		}
		return this.modules[row][col];
	},

	getModuleCount : function() {
		return this.moduleCount;
	},
	
	make : function() {
		// Calculate automatically typeNumber if provided is < 1
		if (this.typeNumber < 1 ){
			var typeNumber = 1;
			for (typeNumber = 1; typeNumber < 40; typeNumber++) {
				var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);

				var buffer = new QRBitBuffer();
				var totalDataCount = 0;
				for (var i = 0; i < rsBlocks.length; i++) {
					totalDataCount += rsBlocks[i].dataCount;
				}

				for (var x = 0; x < this.dataList.length; x++) {
					var data = this.dataList[x];
					buffer.put(data.mode, 4);
					buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
					data.write(buffer);
				}
				if (buffer.getLengthInBits() <= totalDataCount * 8)
					break;
			}
			this.typeNumber = typeNumber;
		}
		this.makeImpl(false, this.getBestMaskPattern() );
	},
	
	makeImpl : function(test, maskPattern) {
		
		this.moduleCount = this.typeNumber * 4 + 17;
		this.modules = new Array(this.moduleCount);
		
		for (var row = 0; row < this.moduleCount; row++) {
			
			this.modules[row] = new Array(this.moduleCount);
			
			for (var col = 0; col < this.moduleCount; col++) {
				this.modules[row][col] = null;//(col + row) % 3;
			}
		}
	
		this.setupPositionProbePattern(0, 0);
		this.setupPositionProbePattern(this.moduleCount - 7, 0);
		this.setupPositionProbePattern(0, this.moduleCount - 7);
		this.setupPositionAdjustPattern();
		this.setupTimingPattern();
		this.setupTypeInfo(test, maskPattern);
		
		if (this.typeNumber >= 7) {
			this.setupTypeNumber(test);
		}
	
		if (this.dataCache === null) {
			this.dataCache = QRCode.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
		}
	
		this.mapData(this.dataCache, maskPattern);
	},

	setupPositionProbePattern : function(row, col)  {
		
		for (var r = -1; r <= 7; r++) {
			
			if (row + r <= -1 || this.moduleCount <= row + r) continue;
			
			for (var c = -1; c <= 7; c++) {
				
				if (col + c <= -1 || this.moduleCount <= col + c) continue;
				
				if ( (0 <= r && r <= 6 && (c === 0 || c === 6) ) || 
                     (0 <= c && c <= 6 && (r === 0 || r === 6) ) || 
                     (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
					this.modules[row + r][col + c] = true;
				} else {
					this.modules[row + r][col + c] = false;
				}
			}		
		}		
	},
	
	getBestMaskPattern : function() {
	
		var minLostPoint = 0;
		var pattern = 0;
	
		for (var i = 0; i < 8; i++) {
			
			this.makeImpl(true, i);
	
			var lostPoint = QRUtil.getLostPoint(this);
	
			if (i === 0 || minLostPoint >  lostPoint) {
				minLostPoint = lostPoint;
				pattern = i;
			}
		}
	
		return pattern;
	},
	
	createMovieClip : function(target_mc, instance_name, depth) {
	
		var qr_mc = target_mc.createEmptyMovieClip(instance_name, depth);
		var cs = 1;
	
		this.make();

		for (var row = 0; row < this.modules.length; row++) {
			
			var y = row * cs;
			
			for (var col = 0; col < this.modules[row].length; col++) {
	
				var x = col * cs;
				var dark = this.modules[row][col];
			
				if (dark) {
					qr_mc.beginFill(0, 100);
					qr_mc.moveTo(x, y);
					qr_mc.lineTo(x + cs, y);
					qr_mc.lineTo(x + cs, y + cs);
					qr_mc.lineTo(x, y + cs);
					qr_mc.endFill();
				}
			}
		}
		
		return qr_mc;
	},

	setupTimingPattern : function() {
		
		for (var r = 8; r < this.moduleCount - 8; r++) {
			if (this.modules[r][6] !== null) {
				continue;
			}
			this.modules[r][6] = (r % 2 === 0);
		}
	
		for (var c = 8; c < this.moduleCount - 8; c++) {
			if (this.modules[6][c] !== null) {
				continue;
			}
			this.modules[6][c] = (c % 2 === 0);
		}
	},
	
	setupPositionAdjustPattern : function() {
	
		var pos = QRUtil.getPatternPosition(this.typeNumber);
		
		for (var i = 0; i < pos.length; i++) {
		
			for (var j = 0; j < pos.length; j++) {
			
				var row = pos[i];
				var col = pos[j];
				
				if (this.modules[row][col] !== null) {
					continue;
				}
				
				for (var r = -2; r <= 2; r++) {
				
					for (var c = -2; c <= 2; c++) {
					
						if (Math.abs(r) === 2 || 
                            Math.abs(c) === 2 ||
                            (r === 0 && c === 0) ) {
							this.modules[row + r][col + c] = true;
						} else {
							this.modules[row + r][col + c] = false;
						}
					}
				}
			}
		}
	},
	
	setupTypeNumber : function(test) {
	
		var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
        var mod;
	
		for (var i = 0; i < 18; i++) {
			mod = (!test && ( (bits >> i) & 1) === 1);
			this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
		}
	
		for (var x = 0; x < 18; x++) {
			mod = (!test && ( (bits >> x) & 1) === 1);
			this.modules[x % 3 + this.moduleCount - 8 - 3][Math.floor(x / 3)] = mod;
		}
	},
	
	setupTypeInfo : function(test, maskPattern) {
	
		var data = (this.errorCorrectLevel << 3) | maskPattern;
		var bits = QRUtil.getBCHTypeInfo(data);
        var mod;
	
		// vertical		
		for (var v = 0; v < 15; v++) {
	
			mod = (!test && ( (bits >> v) & 1) === 1);
	
			if (v < 6) {
				this.modules[v][8] = mod;
			} else if (v < 8) {
				this.modules[v + 1][8] = mod;
			} else {
				this.modules[this.moduleCount - 15 + v][8] = mod;
			}
		}
	
		// horizontal
		for (var h = 0; h < 15; h++) {
	
			mod = (!test && ( (bits >> h) & 1) === 1);
			
			if (h < 8) {
				this.modules[8][this.moduleCount - h - 1] = mod;
			} else if (h < 9) {
				this.modules[8][15 - h - 1 + 1] = mod;
			} else {
				this.modules[8][15 - h - 1] = mod;
			}
		}
	
		// fixed module
		this.modules[this.moduleCount - 8][8] = (!test);
	
	},
	
	mapData : function(data, maskPattern) {
		
		var inc = -1;
		var row = this.moduleCount - 1;
		var bitIndex = 7;
		var byteIndex = 0;
		
		for (var col = this.moduleCount - 1; col > 0; col -= 2) {
	
			if (col === 6) col--;
	
			while (true) {
	
				for (var c = 0; c < 2; c++) {
					
					if (this.modules[row][col - c] === null) {
						
						var dark = false;
	
						if (byteIndex < data.length) {
							dark = ( ( (data[byteIndex] >>> bitIndex) & 1) === 1);
						}
	
						var mask = QRUtil.getMask(maskPattern, row, col - c);
	
						if (mask) {
							dark = !dark;
						}
						
						this.modules[row][col - c] = dark;
						bitIndex--;
	
						if (bitIndex === -1) {
							byteIndex++;
							bitIndex = 7;
						}
					}
				}
								
				row += inc;
	
				if (row < 0 || this.moduleCount <= row) {
					row -= inc;
					inc = -inc;
					break;
				}
			}
		}
		
	}

};

QRCode.PAD0 = 0xEC;
QRCode.PAD1 = 0x11;

QRCode.createData = function(typeNumber, errorCorrectLevel, dataList) {
	
	var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
	
	var buffer = new QRBitBuffer();
	
	for (var i = 0; i < dataList.length; i++) {
		var data = dataList[i];
		buffer.put(data.mode, 4);
		buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
		data.write(buffer);
	}

	// calc num max data.
	var totalDataCount = 0;
	for (var x = 0; x < rsBlocks.length; x++) {
		totalDataCount += rsBlocks[x].dataCount;
	}

	if (buffer.getLengthInBits() > totalDataCount * 8) {
		throw new Error("code length overflow. (" + 
            buffer.getLengthInBits() + 
            ">" +  
            totalDataCount * 8 + 
            ")");
	}

	// end code
	if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
		buffer.put(0, 4);
	}

	// padding
	while (buffer.getLengthInBits() % 8 !== 0) {
		buffer.putBit(false);
	}

	// padding
	while (true) {
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD0, 8);
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD1, 8);
	}

	return QRCode.createBytes(buffer, rsBlocks);
};

QRCode.createBytes = function(buffer, rsBlocks) {

	var offset = 0;
	
	var maxDcCount = 0;
	var maxEcCount = 0;
	
	var dcdata = new Array(rsBlocks.length);
	var ecdata = new Array(rsBlocks.length);
	
	for (var r = 0; r < rsBlocks.length; r++) {

		var dcCount = rsBlocks[r].dataCount;
		var ecCount = rsBlocks[r].totalCount - dcCount;

		maxDcCount = Math.max(maxDcCount, dcCount);
		maxEcCount = Math.max(maxEcCount, ecCount);
		
		dcdata[r] = new Array(dcCount);
		
		for (var i = 0; i < dcdata[r].length; i++) {
			dcdata[r][i] = 0xff & buffer.buffer[i + offset];
		}
		offset += dcCount;
		
		var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
		var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);

		var modPoly = rawPoly.mod(rsPoly);
		ecdata[r] = new Array(rsPoly.getLength() - 1);
		for (var x = 0; x < ecdata[r].length; x++) {
            var modIndex = x + modPoly.getLength() - ecdata[r].length;
			ecdata[r][x] = (modIndex >= 0)? modPoly.get(modIndex) : 0;
		}

	}
	
	var totalCodeCount = 0;
	for (var y = 0; y < rsBlocks.length; y++) {
		totalCodeCount += rsBlocks[y].totalCount;
	}

	var data = new Array(totalCodeCount);
	var index = 0;

	for (var z = 0; z < maxDcCount; z++) {
		for (var s = 0; s < rsBlocks.length; s++) {
			if (z < dcdata[s].length) {
				data[index++] = dcdata[s][z];
			}
		}
	}

	for (var xx = 0; xx < maxEcCount; xx++) {
		for (var t = 0; t < rsBlocks.length; t++) {
			if (xx < ecdata[t].length) {
				data[index++] = ecdata[t][xx];
			}
		}
	}

	return data;

};

module.exports = QRCode;

};
var QRCode = req('index'), EC = req('QRErrorCorrectLevel');
  return function(text, level){ var q = new QRCode(-1, EC[level || 'M']); q.addData(text); q.make(); var n = q.getModuleCount(), rows = []; for (var r = 0; r < n; r++){ var row = []; for (var c = 0; c < n; c++) row.push(q.isDark(r, c)); rows.push(row); } return rows; };
})();
/* Share card: link, QR code (with the crest in the middle), copy, share and download. Used by ERGS Live and the main app. */
window.ERGSShare = (function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let css = false;
  function style(){ if (css) return; css = true; const s = document.createElement('style'); s.textContent = `
.es-ov{position:fixed;inset:0;z-index:300;display:grid;place-items:center;padding:16px;background:rgba(4,7,18,.78);backdrop-filter:blur(4px)}
.es-card{width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#141b3d;color:#eef0f7;border:1px solid rgba(217,192,140,.5);border-radius:18px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;gap:14px}
.es-h{display:flex;align-items:center;gap:10px}.es-h h2{margin:0;flex:1;font-size:22px;letter-spacing:.02em;text-transform:uppercase}
.es-x{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:transparent;color:#eef0f7;font-size:18px;cursor:pointer}
.es-tabs{display:flex;gap:6px;flex-wrap:wrap}.es-tabs button{flex:1;min-height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#eef0f7;font-weight:600;cursor:pointer}
.es-tabs button[aria-pressed="true"]{background:#d9c08c;color:#1a1630;border-color:#d9c08c}
.es-desc{margin:0;color:#aab0c8;font-size:14px;line-height:1.45}
.es-qr{justify-self:center;background:#fff;border-radius:16px;padding:14px;box-shadow:0 6px 20px rgba(0,0,0,.35)}.es-qr canvas{display:block;width:min(240px,62vw);height:auto;image-rendering:pixelated}
.es-link{display:flex;gap:8px;align-items:center;background:#0b1028;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 10px}.es-link input{flex:1;min-width:0;background:transparent;border:0;color:#eef0f7;font:14px ui-monospace,Menlo,monospace}
.es-btns{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
.es-btns button{min-height:44px;border-radius:12px;border:1px solid rgba(217,192,140,.6);background:transparent;color:#eef0f7;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:13px;cursor:pointer}
.es-btns button.p{background:#d9c08c;color:#1a1630;border-color:#d9c08c}
.es-note{margin:0;color:#aab0c8;font-size:12px;text-align:center}
.es-soc{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px}
.es-s{display:flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:6px 8px;border-radius:12px;color:#fff;text-decoration:none;font-weight:700;font-size:13px}
.es-fb{background:#1877F2}.es-wa{background:#1FA855}.es-ms{background:#A033FF}.es-tw{background:#000;border:1px solid rgba(255,255,255,.25)}.es-em{background:#2D3962}.es-s:hover{filter:brightness(1.12)}`; document.head.appendChild(s); }
  function draw(url, crestSrc){
    const m = window.ERGSQR(url, 'H'), n = m.length, q = 4, sc = 12, size = (n + q*2)*sc, c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#0f1530';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (m[r][k]) g.fillRect((k + q)*sc, (r + q)*sc, sc, sc);
    if (crestSrc){ const im = new Image(); im.onload = () => { const box = Math.round(size*0.22), x = (size - box)/2; g.fillStyle = '#fff'; const p = sc*0.8; g.beginPath(); if (g.roundRect) g.roundRect(x - p, x - p, box + 2*p, box + 2*p, sc); else g.rect(x - p, x - p, box + 2*p, box + 2*p); g.fill();
      const k = Math.min(box/im.naturalWidth, box/im.naturalHeight), w = im.naturalWidth*k, h = im.naturalHeight*k; g.drawImage(im, (size - w)/2, (size - h)/2, w, h); }; im.src = crestSrc; }
    return c;
  }
  // one tap to the big apps: Facebook, WhatsApp, Messenger (phones), X and email
  const SV = p => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${p}</svg>`;
  function soc(it){ const u = encodeURIComponent(it.url), t = it.shareText || it.desc || it.label, tx = encodeURIComponent(t), phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return [['fb', 'Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + u, SV('<path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.3H7.4V14h2.7v8z"/>')],
      ['wa', 'WhatsApp', 'https://wa.me/?text=' + encodeURIComponent(t + ' ' + it.url), SV('<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.8 14.1c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5-4.5-.2-.2-1.2-1.6-1.2-3s.8-2.2 1-2.5c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.6-.1 1.3z"/>')]]
      .concat(phone ? [['ms', 'Messenger', 'fb-messenger://share/?link=' + u, SV('<path d="M12 2C6.4 2 2 6.1 2 11.5c0 2.8 1.2 5.3 3.2 7v3.5l3-1.7c1.2.3 2.5.5 3.8.5 5.6 0 10-4.1 10-9.3S17.6 2 12 2zm1 12.4-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 5-2.7z"/>')]] : [])
      .concat([['tw', 'X', 'https://twitter.com/intent/tweet?text=' + tx + '&url=' + u, SV('<path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/>')],
        ['em', 'Email', 'mailto:?subject=' + encodeURIComponent(it.label) + '&body=' + encodeURIComponent(t + '\n\n' + it.url), SV('<path d="M3 5h18v14H3zm2 2v.5l7 4.6 7-4.6V7zm14 2.9-7 4.6-7-4.6V17h14z"/>')]]); }
  function open(o){
    style(); const items = o.items || []; let cur = 0;
    const ov = document.createElement('div'); ov.className = 'es-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', o.title || 'Share');
    const close = () => { ov.remove(); document.removeEventListener('keydown', key); }, key = e => { if (e.key === 'Escape') close(); };
    const render = () => { const it = items[cur];
      ov.innerHTML = `<div class="es-card"><div class="es-h"><h2>${esc(o.title || 'Share')}</h2><button type="button" class="es-x" aria-label="Close">✕</button></div>
        ${items.length > 1 ? `<div class="es-tabs">${items.map((x, i) => `<button type="button" data-i="${i}" aria-pressed="${i === cur}">${esc(x.label)}</button>`).join('')}</div>` : ''}
        <p class="es-desc">${esc(it.desc || '')}</p><div class="es-qr" aria-label="QR code for ${esc(it.label)}"></div>
        <div class="es-link"><input readonly value="${esc(it.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}" aria-label="Link"></div>
        <div class="es-soc" aria-label="Share to">${soc(it).map(([k, t, h, svg]) => `<a class="es-s es-${k}" href="${esc(h)}" target="_blank" rel="noopener" title="Share on ${t}"><span aria-hidden="true">${svg}</span>${t}</a>`).join('')}</div>
        <div class="es-btns"><button type="button" class="p" data-a="copy">Copy link</button>${navigator.share ? '<button type="button" data-a="share">More…</button>' : ''}<button type="button" data-a="dl">Save QR code</button></div>
        <p class="es-note">Point a phone camera at the code to open ${esc(it.label)}. Print the QR code for posters and programmes.</p></div>`;
      const cv = draw(it.url, o.crest); ov.querySelector('.es-qr').appendChild(cv);
      ov.querySelector('.es-x').onclick = close; ov.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { cur = +b.dataset.i; render(); });
      const inp = ov.querySelector('.es-link input'); inp.onclick = () => inp.select();
      ov.querySelector('[data-a="copy"]').onclick = async e => { try { await navigator.clipboard.writeText(it.url); e.target.textContent = 'Copied ✓'; } catch(err){ inp.select(); e.target.textContent = 'Select & copy'; } setTimeout(() => { e.target.textContent = 'Copy link'; }, 2000); };
      const sh = ov.querySelector('[data-a="share"]'); if (sh) sh.onclick = async () => { try { await navigator.share({title:it.label, text:it.shareText || it.desc || it.label, url:it.url}); } catch(err){} };
      ov.querySelector('[data-a="dl"]').onclick = () => { setTimeout(() => { cv.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (it.file || 'ergs-qr') + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png'); }, 150); };
    };
    ov.addEventListener('click', e => { if (e.target === ov) close(); }); document.addEventListener('keydown', key);
    document.body.appendChild(ov); render();
  }
  return {open};
})();

(() => {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);
const CFG = window.ERGS_CONFIG || {};
const RAW = {matches:[], schools:{}, crest:window.ERGS_CREST || ''};   // last snapshot from the database
const DATA = clone(RAW);
let SANDBOX = false, REAL = null, SB = null, SB_ROLE = null, SB_FB = null, SB_STEPS = true;   // the demo (practice mode)                           // what gets shown
const MAIN_APP = CFG.mainApp || 'https://claude.ai/artifact/5Xp2Q4mof4rU3NYuzrAhsK';
const OUR_RX = /\b(ergs|enniskillen)\b/i;
const HOME_GROUND = 'Eisenhower Playing Fields';
const SCHOOL_NICKNAMES = {'methody':'Methodist College Belfast','mcb':'Methodist College Belfast','inst':'Royal Belfast Academical Institution','rbai':'Royal Belfast Academical Institution','bra':'Belfast Royal Academy','rsd':'Royal School Dungannon','rsa':'Royal School Armagh','friends':'Friends’ School Lisburn','portora':'Portora Royal School','sullivan':'Sullivan Upper School','sullivan upper':'Sullivan Upper School'};
/* one name per school, so "Belfast High" and "Belfast High School" (or "Wallace" and "Wallace High School") count as the same opponent */
function canonSchool(n){
  n = String(n || '').trim(); if (!n || OUR_RX.test(n)) return n;
  const k = schoolKey(n); if (SCHOOL_NICKNAMES[k]) return SCHOOL_NICKNAMES[k];
  const words = k.split(' ').filter(Boolean); if (!words.length) return n;
  const match = list => { const exact = list.find(u => schoolKey(u) === k); if (exact) return exact;
    const hits = list.filter(u => { const uw = schoolKey(u).split(' '); return words.length < uw.length && words.every((w, i) => uw[i] === w); }); return hits.length === 1 ? hits[0] : ''; };
  // the official list of Ulster schools wins, then schools added by coaches
  const others = Object.values((typeof DATA !== 'undefined' && DATA.schools) || {}).map(x => x && x.name).filter(Boolean).filter(x => !ULSTER.includes(x));
  return match(ULSTER) || match(others) || n;
}
const ULSTER = ['Antrim Grammar School','Ballyclare High School','Ballymena Academy','Banbridge Academy','Bangor Grammar School','Belfast High School','Belfast Royal Academy','Cambridge House Grammar School','Campbell College','Coleraine Grammar School','Dalriada School','Down High School','Foyle College','Friends’ School Lisburn','Grosvenor Grammar School','Larne Grammar School','Limavady Grammar School','Lurgan College','Methodist College Belfast','Omagh Academy','Portadown College','Portora Royal School','Rainey Endowed School','Regent House School','Royal Belfast Academical Institution','Royal School Armagh','Royal School Dungannon','Sullivan Upper School','Wallace High School'];
const PTS = {try:5, con:2, pen:3, dg:3, pt:7};
const EVK = {try:['Try','T'], con:['Conversion','C'], pen:['Penalty goal','P'], dg:['Drop goal','DG'], pt:['Penalty try','PT'], yc:['Yellow card','YC'], rc:['Red card','RC'], note:['','']};
const ptsOf = e => e.miss ? 0 : (PTS[e.k] || 0);
function shiftDemo(D){ if (!D.demo) return; const now = Date.now(); D.updated = now - 200*1000; for (const m of D.matches){ if (m.koIn != null) m.ko = new Date(now + m.koIn*864e5).toISOString().slice(0, 10) + 'T' + (m.koTime || '10:30'); if (m.clock && m.clock.runFor != null) m.clock.since = now - m.clock.runFor*1000; for (const e of m.events || []) if (e.ago != null) e.ts = now - e.ago*1000; }  }
shiftDemo(DATA);

/* ---------- page shell ---------- */
document.body.insertAdjacentHTML('beforeend', `
<div class="wrap">
  <header><img id="crestImg" alt="Enniskillen Royal Grammar School crest"><h1>ERGS <span>Live</span></h1><span class="sp"></span><div class="hd-r"><span class="pill live">Live scores</span><span id="installSlot"></span></div></header>
  <div class="coachbar" id="coachBar" hidden></div>
  <div class="playerbar" id="playerBar" hidden></div>
  <div class="playerbar supbar" id="supBar" hidden></div>
  <div class="demo" id="demoBar" hidden><span><b>Preview with example matches.</b> Real scores replace these once coaches start scoring here.</span><button type="button" id="demoTry">Show a try landing</button></div>
  <nav class="tabs" id="tabs" aria-label="Sections"><button type="button" data-v="matches">Matches</button><button type="button" data-v="fixtures">Fixtures</button><button type="button" data-v="results">Results</button></nav>
  <main id="view" aria-live="polite"></main>
  <footer><span>Enniskillen Royal Grammar School Rugby</span><span><span id="autoNote" hidden>Refreshes every 30 seconds during a match · </span><span id="updated"></span></span></footer>
</div>
<div class="fx" id="fx" hidden aria-live="assertive"><div class="fx-band"></div><div class="fx-burst" id="fxBurst"></div><div class="fx-in"><div class="fx-crest" id="fxCrest"></div><div class="fx-kind" id="fxKind"></div><div class="fx-face" id="fxFace" hidden></div><div class="fx-who" id="fxWho"></div><div class="fx-score" id="fxScore"></div></div></div>
<div class="modal" id="modal" hidden><div class="dialog" id="dialog" role="dialog" aria-modal="true"></div></div>
<div class="saving" id="saving" hidden><span class="spin"></span><span id="savingT">Sending to everyone…</span></div>
<div class="toast" id="toast" hidden role="status"></div>`);
$('#crestImg').src = DATA.crest;
let toastT = 0;
function toast(t){ const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, Math.max(3200, t.length * 60)); }

/* ---------- helpers ---------- */
const isLive = m => m.status === '1H' || m.status === 'HT' || m.status === '2H';
const usOf = m => m.us || (OUR_RX.test(m.home) ? 'H' : OUR_RX.test(m.away) ? 'A' : '');
function score(m){ let h = 0, a = 0, any = false; for (const e of m.events || []){ const p = ptsOf(e); if (p) any = true; if (e.s === 'H') h += p; else if (e.s === 'A') a += p; } return !any && Array.isArray(m.final) ? [+m.final[0], +m.final[1]] : [h, a]; }
const elapsed = m => { const c = m.clock || {}; return Math.max(0, (c.base || 0) + (c.running && c.since ? (Date.now() - c.since)/1000 : 0)); };
const mm = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
const minuteNow = m => m.status === 'pre' ? 0 : Math.max(1, Math.ceil(elapsed(m)/60));
const kot = m => { const t = Date.parse(m.ko); return isNaN(t) ? 0 : t; };
const when = (m, long) => { if (!kot(m)) return ''; const d = new Date(kot(m)); const day = d.toLocaleDateString('en-GB', long ? {weekday:'long', day:'numeric', month:'long'} : {weekday:'short', day:'numeric', month:'short'}); return m.koTbc ? day : day + ', ' + d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}); };
function clockText(m){ if (m.status === 'HT') return 'Half time'; if (m.status === 'FT') return 'Full time'; if (m.status === 'pre') return when(m) || 'Not started'; return mm(elapsed(m)) + (m.clock && !m.clock.running ? ' · paused' : ''); }
const compLine = m => [m.team, m.comp, m.round].filter(Boolean).join(' · ');
const school = n => { if (OUR_RX.test(n)) return {crest:DATA.crest, color:'#1C2342'}; const S0 = DATA.schools || {}, k = schoolKey(n); const c = canonSchool(n); return S0[k] || S0[n] || Object.values(S0).find(v => v && (schoolKey(v.name) === k || (Array.isArray(v.aliases) && v.aliases.some(a => schoolKey(a) === k)))) || Object.values(S0).find(v => v && v.name && canonSchool(v.name) === c) || null; };
function schoolKey(n){ return String(n || '').toLowerCase().replace(/[’'`.]/g, '').replace(/\bgs\b/g, 'grammar school').replace(/\bhs\b/g, 'high school').replace(/\bes\b/g, 'endowed school').replace(/\brs\b/g, 'royal school').replace(/\bcoll\b/g, 'college').replace(/\bacad\b/g, 'academy').replace(/\bsch\b/g, 'school').replace(/\bint\b/g, 'integrated').replace(/\bst\b/g, 'saint').replace(/\b(1st|2nd|3rd|xv|vii|7s|u1\d|medallion|girls|boys|the)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
const initials = n => { const w = String(n || '?').replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(x => x && !/^(the|of|and|school|college|academy|grammar|high|royal|xv|1st|2nd|u\d+)$/i.test(x)); return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase(); };
function crest(name, cls){ const s = school(name); if (s && s.crest) return `<span class="crest ${cls || ''}"><img alt="" src="${esc(s.crest)}"></span>`; return `<span class="crest ini ${cls || ''}" style="--c:${esc(s && s.color || '#3A4466')}">${esc(initials(name))}</span>`; }
const sorted = m => (m.events || []).slice().sort((a, b) => (a.m - b.m) || (a.ts - b.ts));
const label = e => e.k === 'note' ? (e.p || '') : EVK[e.k][0] + (e.miss ? ' missed' : '') + (e.p ? ' · ' + e.p : '');
function resultOf(m){ const us = usOf(m); if (m.status !== 'FT' || !us) return null; const [h, a] = score(m), f = us === 'H' ? h : a, g = us === 'H' ? a : h; return {r:f > g ? 'W' : f < g ? 'L' : 'D', f, g, opp:us === 'H' ? m.away : m.home}; }
const resPill = r => r ? `<span class="res ${r.r}">${r.r === 'W' ? 'Won' : r.r === 'L' ? 'Lost' : 'Drew'}</span>` : '';

/* ---------- views ---------- */
const UI = (() => { try { const u = JSON.parse(sessionStorage.getItem('ergsLive.ui') || 'null'); sessionStorage.removeItem('ergsLive.ui'); return u; } catch(e){ return null; } })();
const V = {tab:UI && UI.tab || 'matches', open:UI && UI.open || null};
let COACH = false, ART = null;
const prev = new Map();
function bins(m, s, full){
  if (m.status === 'pre' || m.status === 'FT') return '';
  // coaches get a quick × to clear a card from the scoreboard (it stays in the timeline)
  const x = e => full && COACH && !DATA.demo ? `<button type="button" class="bin-x" data-unbin="${esc(e.id)}" aria-label="Remove this card from the scoreboard">×</button>` : '';
  return sorted(m).filter(e => e.s === s && (e.k === 'yc' || e.k === 'rc') && !e.ret).map(e => {
    if (e.k === 'rc') return `<span class="bin rc"><i></i>${esc(e.p || 'Red card')}${x(e)}</span>`;
    const left = (e.at || 0) + (m.code === 'sevens' ? 120 : 600) - elapsed(m); if (left <= 0) return '';
    return `<span class="bin yc"><i></i>${esc(e.p || 'Sin bin')} <b data-bin="${esc(m.id)}|${esc(e.id)}">${mm(left)}</b>${x(e)}</span>`; }).join('');
}
function board(m, full){
  const [h, a] = score(m), p = prev.get(m.id); prev.set(m.id, [h, a]);
  const hc = (school(m.home) || {}).color || '#3A4466', ac = (school(m.away) || {}).color || '#3A4466';
  const last = sorted(m).filter(e => e.k !== 'note' || e.p).slice(-3).reverse(), run = isLive(m) && m.clock && m.clock.running;
  return `<${full ? 'div' : 'button type="button" data-open="' + esc(m.id) + '"'} class="sb${isLive(m) ? '' : ' quiet'}" style="--hc:${esc(hc)};--ac:${esc(ac)}">
    <div class="sb-meta">${esc([compLine(m), m.status === '1H' ? '1st half' : m.status === '2H' ? '2nd half' : '', full ? m.venue : ''].filter(Boolean).join(' · '))}</div>
    <div class="sb-main"><div class="side">${crest(m.home, 'big')}<b>${esc(m.home)}</b><div class="bins">${bins(m, 'H', full)}</div></div>
      <div class="score"><span class="${h > a ? 'lead' : ''}${p && p[0] !== h ? ' bump' : ''}">${h}</span><span class="dash">–</span><span class="${a > h ? 'lead' : ''}${p && p[1] !== a ? ' bump' : ''}">${a}</span></div>
      <div class="side">${crest(m.away, 'big')}<b>${esc(m.away)}</b><div class="bins">${bins(m, 'A', full)}</div></div></div>
    <span class="clock">${run ? '<span class="dot"></span>' : ''}<span data-clock="${esc(m.id)}">${esc(clockText(m))}</span>${m.status === 'FT' ? ' ' + resPill(resultOf(m)) : ''}</span>
    ${!full && last.length ? `<div class="last3">${last.map(e => `<div><span>${e.m}′</span><span>${esc(label(e))}${e.k !== 'note' ? ' (' + esc(e.s === 'H' ? m.home : m.away) + ')' : ''}</span></div>`).join('')}</div><span class="tap">Tap for the full timeline</span>` : ''}
  </${full ? 'div' : 'button'}>`;
}
const movedRecent = m => m.moved && m.status === 'pre' && !m.off && Date.now() - (m.moved.at || 0) < 10*864e5;
const wasText = m => { const t = Date.parse(m.moved.from); return isNaN(t) ? '' : new Date(t).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}) + (m.moved.fromTbc ? '' : ', ' + new Date(t).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})); };
/* ---------- match weather: Open-Meteo forecast for the ground at kick-off (up to 16 days ahead) ---------- */
const WX = {geo:{}, fc:{}, busy:{}};
try { WX.geo = JSON.parse(localStorage.getItem('ergs.wxGeo') || '{}') || {}; } catch(e){}
const WX_HOME = {lat:54.3476, lon:-7.6416, name:'Enniskillen'};   // Eisenhower Playing Fields
const WX_KNOWN = {portora:'Enniskillen', 'mount lourdes':'Enniskillen', 'st michael':'Enniskillen', rainey:'Magherafelt', 'wallace':'Lisburn', 'friends':'Lisburn', 'campbell':'Belfast', 'inst':'Belfast', 'methody':'Belfast', 'methodist':'Belfast', 'rbai':'Belfast', 'bra':'Belfast', 'sullivan':'Holywood', 'bangor':'Bangor', 'regent':'Newtownards', 'ballyclare':'Ballyclare', 'carrick':'Carrickfergus', 'coleraine':'Coleraine', 'dalriada':'Ballymoney', 'royal school armagh':'Armagh', 'rs armagh':'Armagh', 'royal school dungannon':'Dungannon', 'rs dungannon':'Dungannon', 'banbridge':'Banbridge', 'lurgan':'Lurgan', 'portadown':'Portadown', 'omagh':'Omagh', 'foyle':'Derry', 'grosvenor':'Belfast', 'down high':'Downpatrick', 'cookstown':'Cookstown', 'larne':'Larne', 'belfast':'Belfast', 'ballymena':'Ballymena', 'antrim':'Antrim', 'limavady':'Limavady', 'strabane':'Strabane', 'newry':'Newry'};
const WX_CODE = c => c === 0 ? ['☀️', 'Clear'] : c <= 2 ? ['🌤️', 'Partly cloudy'] : c === 3 ? ['☁️', 'Cloudy'] : c <= 48 ? ['🌫️', 'Fog'] : c <= 57 ? ['🌦️', 'Drizzle'] : c <= 67 ? ['🌧️', 'Rain'] : c <= 77 ? ['🌨️', 'Snow'] : c <= 82 ? ['🌦️', 'Showers'] : c <= 86 ? ['🌨️', 'Snow showers'] : ['⛈️', 'Thunder'];
const ourName = n => /ERGS|Enniskillen R/i.test(n || '');
function wxPlace(m){ const k = String(m.venue || (usOf(m) === 'A' ? m.home : m.away) || '') + (usOf(m) === 'H' && !m.venue ? '#home' : ''); return WX.busy[k] || (WX.busy[k] = wxPlace0(m)); }
async function wxPlace0(m){
  const home = usOf(m) === 'H' && !m.venue; if (home) return WX_HOME;
  const opp = usOf(m) === 'A' ? m.home : m.away, q = String(m.venue || opp || '').trim(), lk = q.toLowerCase(); if (!q) return null;
  if (WX.geo[lk] !== undefined) return WX.geo[lk];
  let town = Object.keys(WX_KNOWN).find(k => lk.includes(k)); town = town ? WX_KNOWN[town] : null;
  const tries = [town, m.venue, ...String(q).split(/[\s,]+/).filter(w => /^[A-Z][a-z]{3,}/.test(w) && !/^(Royal|Grammar|School|College|Academy|High|Academical|Institution|Methodist|Saint|Collegiate|Integrated|Secondary|Boys|Girls)$/.test(w))].filter(Boolean);
  let hit = null; for (const t of tries){ try { const r = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&name=' + encodeURIComponent(t))).json();
      const g = (r.results || []).find(x => x.country_code === 'GB' && /Northern Ireland/i.test(x.admin1 || '')) || (r.results || []).find(x => x.country_code === 'GB' || x.country_code === 'IE'); if (g){ hit = {lat:g.latitude, lon:g.longitude, name:g.name}; break; } } catch(e){ return null; } }
  WX.geo[lk] = hit; try { localStorage.setItem('ergs.wxGeo', JSON.stringify(WX.geo)); } catch(e){} return hit;
}
async function wxFor(m){
  const t = kot(m); if (!t || m.status !== 'pre' || m.off === 'cancelled') return null; const days = (t - Date.now())/864e5; if (days > 15.5 || days < -0.2) return null;
  const pl = await wxPlace(m); if (!pl) return null; const day = new Date(t).toISOString().slice(0, 10), key = pl.lat.toFixed(2) + ',' + pl.lon.toFixed(2) + ',' + day;
  if (!WX.fc[key]) WX.fc[key] = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pl.lat}&longitude=${pl.lon}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&wind_speed_unit=mph&timezone=UTC&start_date=${day}&end_date=${day}`).then(r => r.json()).catch(() => null);
  const f = await WX.fc[key]; if (!f || !f.hourly || !f.hourly.time) return null;
  const hr = new Date(t).getUTCHours(), i = Math.max(0, f.hourly.time.findIndex(x => +x.slice(11, 13) === hr)), [ic, txt] = WX_CODE(f.hourly.weather_code[i]);
  return {ic, txt, temp:Math.round(f.hourly.temperature_2m[i]), rain:f.hourly.precipitation_probability[i], wind:Math.round(f.hourly.wind_speed_10m[i]), place:pl.name, exact:!m.koTbc};
}
// fill in any weather spots on screen (rows and the match page) once the forecast arrives
function wxFill(){ $$('[data-wx]').forEach(async el => { if (el.dataset.done) return; el.dataset.done = '1'; const m = DATA.matches.find(x => x.id === el.dataset.wx); if (!m) return;
  const w = await wxFor(m); if (!w || !el.isConnected) return;
  if (el.classList.contains('wx-big')) el.innerHTML = `<div class="wx-ic">${w.ic}</div><div class="wx-main"><b>${w.temp}°C · ${esc(w.txt)}</b><span>${w.rain != null ? w.rain + '% chance of rain · ' : ''}wind ${w.wind} mph</span><small>Forecast for ${esc(w.place)}${w.exact ? ' at kick-off' : ''}</small></div>`;
  else { el.textContent = `${w.ic} ${w.temp}°`; el.title = `${w.txt}, ${w.temp}°C, ${w.rain}% rain, wind ${w.wind} mph (${w.place})`; }
  el.hidden = false; }); }
function row(m){
  const d = new Date(kot(m)), us = usOf(m), opp = us === 'A' ? m.home : m.away, r = resultOf(m);
  const right = m.off && m.status === 'pre' ? `<span class="pill off">${m.off === 'cancelled' ? 'Cancelled' : 'Postponed'}</span>` : isLive(m) ? `<span class="pill live" data-clock="${esc(m.id)}">${esc(clockText(m))}</span>` : r ? `${resPill(r)} <b>${r.f}–${r.g}</b>` : '';
  const ha = m.status === 'FT' ? '' : us === 'H' ? ' home' : us === 'A' ? ' away' : '';
  return `<button type="button" class="row${ha}${m.off && m.status === 'pre' ? ' is-off' : ''}" data-open="${esc(m.id)}"><span class="cd"><b>${kot(m) ? d.getDate() : '–'}</b><span>${kot(m) ? esc(d.toLocaleDateString('en-GB', {weekday:'short'})) : ''}</span></span>${crest(opp)}
    <span class="ri"><b>${esc((m.team ? m.team + ' ' : '') + (us === 'A' ? '@ ' : 'v ') + opp)}</b><span>${esc([m.off && m.status === 'pre' ? (m.off === 'cancelled' ? 'CANCELLED' : 'POSTPONED') + (m.offWhy ? ': ' + m.offWhy : '') : movedRecent(m) ? 'NEW DATE (was ' + wasText(m) + ')' : '', m.koTbc ? 'Kick-off to be confirmed' : kot(m) ? d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) : '', us === 'H' ? 'Home' : us === 'A' ? 'Away' : '', m.comp, m.venue].filter(Boolean).join(' · '))}</span></span>
    <span class="rr">${m.status === 'pre' && !m.off && kot(m) && kot(m) - Date.now() < 15.5*864e5 && kot(m) > Date.now() - 3600e3 ? `<span class="wx-chip" data-wx="${esc(m.id)}" hidden></span>` : ''}${COACH && m.status === 'pre' && oppNote(opp) ? '<span class="note-tag" title="You have notes on this school">Notes</span>' : ''}${right || (ha ? `<span class="ha-tag">${us === 'H' ? 'Home' : 'Away'}</span>` : '')}</span></button>`;
}
function viewMatches(){
  const live = DATA.matches.filter(isLive), now = Date.now();
  const allUp = DATA.matches.filter(m => m.status === 'pre' && kot(m) > now - 6*3600e3).sort((a, b) => kot(a) - kot(b));
  // only this week's fixtures here (or the very next one if nothing is on this week); the full list is under Fixtures
  const wk = allUp.filter(m => kot(m) < now + 7*864e5), next = wk.length ? wk : allUp.slice(0, 1), later = allUp.length - next.length;
  const undated = [];
  // latest results can be narrowed by time (past week / month) and by team
  const ftDone = DATA.matches.filter(m => m.status === 'FT'), lSince = V.lPeriod === 'week' ? now - 7*864e5 : V.lPeriod === 'month' ? now - 31*864e5 : 0;
  const allDone = ftDone.filter(m => (!lSince || kot(m) >= lSince) && (!V.lTeam || (teamCode(m.team) || 'Other') === V.lTeam)).sort((a, b) => kot(b) - kot(a)), done = V.moreDone ? allDone : allDone.slice(0, 5);
  const lTeams = TEAM_CODES.filter(c => ftDone.some(m => teamCode(m.team) === c));
  const lFilters = ftDone.length ? `<div class="lr-filters"><div class="team-tabs" role="tablist" aria-label="When">${[['', 'Any time'], ['week', 'Past week'], ['month', 'Past month']].map(([k, t]) => `<button type="button" role="tab" data-lperiod="${k}" aria-pressed="${(V.lPeriod || '') === k}">${t}</button>`).join('')}</div>
      <select class="input lr-team" id="lrTeam" aria-label="Team"><option value="">All teams</option>${lTeams.map(c => `<option value="${c}" ${V.lTeam === c ? 'selected' : ''}>${c} · ${TEAM_NAMES[c]}</option>`).join('')}</select>${V.lPeriod || V.lTeam ? '<button type="button" class="clr-f" data-clear="latest">✕ Clear filters</button>' : ''}</div>` : '';
  const offSoon = DATA.matches.filter(m => ((m.off && kot(m) < now + 8*864e5) || movedRecent(m) || (m.moved && m.status === 'pre' && m.moved.from && Date.parse(m.moved.from) < now + 8*864e5 && Date.parse(m.moved.from) > now - 12*3600e3)) && m.status === 'pre' && kot(m) > now - 12*3600e3).sort((a, b) => kot(a) - kot(b));
  const offBan = offSoon.length ? `<div class="off-ban" role="alert"><b>${offSoon.length === 1 ? 'Fixture change' : 'Fixture changes'}</b>${offSoon.map(m => { const d = new Date(kot(m)); return `<button type="button" data-open="${esc(m.id)}"><span class="off-tag${m.off ? '' : ' moved'}">${m.off === 'cancelled' ? 'Cancelled' : m.off ? 'Postponed' : 'New date'}</span>${esc(d.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}) + (m.off ? '' : m.koTbc ? ', time TBC' : ', ' + d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})) + ' · ' + (m.team ? m.team + ' ' : '') + (usOf(m) === 'A' ? '@ ' : 'v ') + (usOf(m) === 'A' ? m.home : m.away))}${m.off ? (m.offWhy ? `<small>${esc(m.offWhy)}</small>` : '') : `<small>${esc(['Was ' + wasText(m), m.moved.why].filter(Boolean).join(' · '))}</small>`}</button>`; }).join('')}</div>` : '';
  return offBan + `<div class="sec">${live.length ? 'Live now' : 'No match in play'}</div>${live.length ? `<div class="board">${live.map(m => board(m)).join('')}</div>` : `<div class="empty">No ERGS match is in play right now. The score appears here the moment one kicks off.${COACH ? ' Open a fixture below and press Kick off.' : ''}</div>`}
    <div class="sec">${wk.length ? 'Coming up this week' : 'Next fixture'}</div>${next.length ? `<div class="list">${next.map(row).join('')}</div>${later ? `<button type="button" class="more" data-tabgo="fixtures">See all fixtures <small>${later} more</small> →</button>` : ''}` : `<div class="empty">No fixtures announced yet.${COACH ? ' Add a match or import the fixtures list.' : ''}</div>`}
    <div class="sec">Latest results</div>${lFilters}${done.length ? `<div class="list">${done.map(row).join('')}</div>${allDone.length > 5 ? `<button type="button" class="more" data-more="Done">${V.moreDone ? 'Show fewer' : `Show ${allDone.length - 5} more`}</button>` : ''}` : `<div class="empty">${ftDone.length ? `No ${V.lTeam ? esc(TEAM_NAMES[V.lTeam]) + ' ' : ''}results${V.lPeriod === 'week' ? ' in the past week' : V.lPeriod === 'month' ? ' in the past month' : ''}.` : 'No results yet.'}</div>`}`;
}
/* add fixtures to a phone or computer calendar (.ics), for anyone */
function calIcs(list, file){
  const f = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), ours = n => /ERGS|Enniskillen/i.test(n || ''), clean = x => String(x || '').replace(/[,;\\]/g, ' ').replace(/\n/g, ' ');
  const ev = list.filter(m => kot(m)).map(m => { const t = kot(m), home = ours(m.home), opp = home ? m.away : m.home, tc = teamCode(m.team);
    return ['BEGIN:VEVENT', 'UID:' + m.id + '@ergs-live', 'DTSTAMP:' + f(Date.now()), 'DTSTART:' + f(t), 'DTEND:' + f(t + 90*60000),
      'SUMMARY:' + clean(`ERGS ${TEAM_CODES.includes(tc) ? tc : m.team || ''} ${home ? 'v' : '@'} ${opp}`).replace(/\s+/g, ' '), 'LOCATION:' + clean(m.venue || (home ? 'Eisenhower Playing Fields, Enniskillen' : opp)),
      'DESCRIPTION:' + clean(`${m.koTbc ? 'Kick-off time to be confirmed. ' : ''}Live scores on ERGS Live: ${LIVE_URL}`), 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:ERGS rugby today', 'END:VALARM', 'END:VEVENT'].join('\r\n'); });
  if (!ev.length){ toast('No dated fixtures to add.'); return; }
  const txt = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ERGS Live//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:ERGS Rugby'].concat(ev, ['END:VCALENDAR']).join('\r\n');
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], {type:'text/calendar'})); a.download = file; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    toast(ev.length === 1 ? 'Open the file to add it to your calendar.' : `${ev.length} fixtures ready. Open the file to add them to your calendar.`); } catch(e){ toast('That didn’t work on this device.'); }
}
/* ---------- season calendar: every match this season on a month-by-month calendar, for the teams you pick ---------- */
const CAL_COL = {'1XV':'#DCC08A','2XV':'#5BC0FF','3XV':'#9B8CFF','U16':'#FF8A65','Meds':'#4CD18A','U14':'#FF5DA8','U13':'#FFD21F','U12':'#2FD4C9','SG':'#E5484D','JG':'#F4A6C0'};
const calCol = t => CAL_COL[t] || '#9aa3c0';
try { V.fxView = localStorage.getItem('ergs.fxView') || ''; } catch(e){}
try { const v = JSON.parse(localStorage.getItem('ergs.calTeams') || '[]'); V.calTeams = new Set(Array.isArray(v) ? v : []); } catch(e){ V.calTeams = new Set(); }
function viewCalendar(){
  const d0 = new Date(), sy = d0.getMonth() >= 7 ? d0.getFullYear() : d0.getFullYear() - 1, from = new Date(sy, 7, 1).getTime(), to = new Date(sy + 1, 7, 1).getTime();
  const season = DATA.matches.filter(m => kot(m) >= from && kot(m) < to), tOf = m => teamCode(m.team) || m.team || 'Other';
  const teams = [...new Set(season.map(tOf))].sort((a, b) => (TEAM_CODES.indexOf(a) + 1 || 99) - (TEAM_CODES.indexOf(b) + 1 || 99));
  [...V.calTeams].forEach(t => { if (!teams.includes(t)) V.calTeams.delete(t); });
  const show = season.filter(m => (!V.calTeams.size || V.calTeams.has(tOf(m))) && haOK(m)), byDay = {};
  show.forEach(m => { const d = new Date(kot(m)), k = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); (byDay[k] = byDay[k] || []).push(m); });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const chips = tmChips(teams);
  let months = '';
  for (let mi = 0; mi < 12; mi++){ const y = sy + (mi + 7 >= 12 ? 1 : 0), mo = (mi + 7) % 12, first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate(), lead = (first.getDay() + 6) % 7;
    const any = Object.keys(byDay).some(k => k.startsWith(y + '-' + mo + '-')); if (!any && (mo === 6 || mo === 7 && mi > 0)) continue;   // skip empty summer months
    let cells = '<i class="cal-h">M</i><i class="cal-h">T</i><i class="cal-h">W</i><i class="cal-h">T</i><i class="cal-h">F</i><i class="cal-h">S</i><i class="cal-h">S</i>' + '<i></i>'.repeat(lead);
    for (let d = 1; d <= days; d++){ const k = y + '-' + mo + '-' + d, ms = byDay[k] || [], dt = new Date(y, mo, d), past = dt < today, isToday = +dt === +today, sel = V.calDay === k;
      const res = ms.length === 1 && ms[0].status === 'FT' ? (() => { const sc = score(ms[0]), u = /ERGS|Enniskillen/i.test(ms[0].home) ? 0 : 1, f = sc[u], g = sc[1 - u]; return f > g ? 'W' : f < g ? 'L' : 'D'; })() : '';
      cells += ms.length ? `<button type="button" class="cal-d has${past ? ' past' : ''}${isToday ? ' today' : ''}${sel ? ' sel' : ''}${ms.some(m => m.off) ? ' off' : ''}" data-cald="${k}" aria-label="${dt.toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'})}: ${ms.length} match${ms.length === 1 ? '' : 'es'}">${d}<span class="cal-dots">${ms.slice(0, 4).map(m => `<b style="background:${calCol(tOf(m))}"></b>`).join('')}</span>${res ? `<em class="r-${res}">${res}</em>` : ''}</button>`
        : `<i class="cal-d${past ? ' past' : ''}${isToday ? ' today' : ''}">${d}</i>`; }
    months += `<div class="cal-m${y === today.getFullYear() && mo === today.getMonth() ? ' now' : ''}"><div class="cal-mh">${first.toLocaleDateString('en-GB', {month:'long', year:'numeric'})}</div><div class="cal-g">${cells}</div></div>`; }
  const dayList = V.calDay && byDay[V.calDay] ? `<div class="cal-day" id="calDay"><div class="sec">${esc(new Date(kot(byDay[V.calDay][0])).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'}))}</div><div class="list">${byDay[V.calDay].sort((a, b) => kot(a) - kot(b)).map(row).join('')}</div></div>` : '';
  return `${chips}<div class="cal-sum">${show.length} match${show.length === 1 ? '' : 'es'} this season${V.calTeams.size ? ' for ' + esc([...V.calTeams].map(t => TEAM_NAMES[t] || t).join(', ')) : ''} · tap a day to see them</div>${dayList}<div class="cal-ms">${months}</div>`;
}
const haOK = m => !V.ha || usOf(m) === V.ha;
const tmOf = m => teamCode(m.team) || m.team || 'Other', tmOK = m => !V.calTeams.size || V.calTeams.has(tmOf(m));   // the team chips (shared by the list and the calendar)
const tmChips = teams => `<div class="cal-teams" role="group" aria-label="Teams to show"><button type="button" data-calt="" aria-pressed="${!V.calTeams.size}">All teams</button>${teams.map(t => `<button type="button" data-calt="${esc(t)}" aria-pressed="${V.calTeams.has(t)}"><i style="background:${calCol(t)}"></i>${esc(TEAM_NAMES[t] || t)}</button>`).join('')}</div>`;   // the Home / Away filter on Fixtures (and its season calendar)
const haBar = () => `<div class="ha-key ha-f" role="group" aria-label="Home or away"><button type="button" data-ha="" aria-pressed="${!V.ha}">All</button><button type="button" data-ha="H" aria-pressed="${V.ha === 'H'}"><i class="k-h"></i>Home, at Eisenhower Playing Fields</button><button type="button" data-ha="A" aria-pressed="${V.ha === 'A'}"><i class="k-a"></i>Away</button></div>`;
function viewFixtures(){
  const now = Date.now(), up0 = DATA.matches.filter(m => m.status !== 'FT' && kot(m) > now - 6*3600e3), up = up0.filter(m => haOK(m) && tmOK(m)).sort((a, b) => kot(a) - kot(b));
  const allTeams = [...new Set(up0.map(tmOf))].sort((a, b) => (TEAM_CODES.indexOf(a) + 1 || 99) - (TEAM_CODES.indexOf(b) + 1 || 99)), chipsL = allTeams.length > 1 ? tmChips(allTeams) : '';
  const undated = COACH ? DATA.matches.filter(m => m.status === 'pre' && !kot(m)) : [];
  const tog = `<div class="fx-view" role="tablist"><button type="button" data-fxv="list" aria-pressed="${V.fxView !== 'cal'}">List</button><button type="button" data-fxv="cal" aria-pressed="${V.fxView === 'cal'}">📅 Season calendar</button></div>`;
  if (V.fxView === 'cal') return tog + haBar() + viewCalendar();
  if (!up.length && !undated.length) return tog + chipsL + haBar() + `<div class="empty">${V.ha || V.calTeams.size ? `No upcoming fixtures match. <button type="button" class="lnk" data-fxclear>Show all</button>` : 'No upcoming fixtures yet.'}</div>`;
  const calBar = up.some(m => kot(m)) ? `<div class="cal-bar"><span>📅 Add ${V.calTeams.size || V.ha ? 'these' : 'all'} fixtures to your calendar</span><button type="button" class="btn" data-calall>Add ${up.filter(m => kot(m)).length}</button></div>` : '';
  let out = tog + chipsL + haBar() + calBar, cur = '';
  for (const m of up){ const k = new Date(kot(m)).toLocaleDateString('en-GB', {month:'long', year:'numeric'}); if (k !== cur){ if (cur) out += '</div>'; out += `<div class="month">${esc(k)}</div><div class="list">`; cur = k; } out += row(m); }
  if (cur) out += '</div>';
  if (undated.length) out += `<div class="month">Date to be confirmed</div><div class="list">${undated.map(row).join('')}</div>`;
  return out;
}
const TEAM_CODES = ['1XV','2XV','3XV','U16','Meds','U14','U13','U12','SG','JG'];
/* "Our team" dropdown: every team, with an older free-typed name kept if it doesn't match one */
function teamOptions(cur){
  const c = teamCode(cur), sel = TEAM_CODES.includes(c) ? c : cur ? 'custom' : '1XV';
  return TEAM_CODES.map(t => `<option value="${t}" ${sel === t ? 'selected' : ''}>${t} · ${TEAM_NAMES[t]}</option>`).join('') + (sel === 'custom' ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '');
}
const TEAM_NAMES = {'1XV':'1st XV','2XV':'2nd XV','3XV':'3rd XV','U16':'Under 16','Meds':'Medallion','U14':'Under 14','U13':'Under 13','U12':'Under 12','SG':'Senior girls','JG':'Junior girls'};
/* which of our teams a match was, from whatever was typed in "Our team" */
function teamCode(t){
  const x = String(t || '').toLowerCase().replace(/[’'.]/g, '').replace(/\s+/g, ' ').trim(); if (!x) return '';
  const girls = /\b(girl|girls|women|ladies|sg|jg)\b/.test(x);
  if (girls) return /\b(junior|jg|u1[2-5]|under 1[2-5]|minis?)\b/.test(x) ? 'JG' : 'SG';
  if (/\b(med|meds|medallion)\b/.test(x)) return 'Meds';
  const u = x.match(/\b(?:u|under ?)(1[2-9])s?\b/); if (u) return ['12','13','14','16'].includes(u[1]) ? 'U' + u[1] : u[1] === '15' ? 'Meds' : 'U16';
  if (/\b(1st|first|1)\s*(xv|15s?)\b|\b1xv\b|\bseniors?\b/.test(x)) return '1XV';
  if (/\b(2nd|second|2)\s*(xv|15s?)\b|\b2xv\b/.test(x)) return '2XV';
  if (/\b(3rd|third|3)\s*(xv|15s?)\b|\b3xv\b/.test(x)) return '3XV';
  return 'Other';
}
/* seasons run from August to July: a match on 14 Feb 2026 is in 2025/26 */
const seasonOf = m => { const t = kot(m); if (!t) return 0; const d = new Date(t); return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; };
const seasonLabel = y => `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
// a year group moves up one team each season
// after the Medallion year, pupils go straight into the 1st XV (for the last two years of school)
const COHORT = ['U12','U13','U14','Meds','1XV','1XV'];
/* season leaderboards: tries, points and appearances for the results being shown (coaches and players) */
function leaders(list){
  const P = new Map(), key = n => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const get = n => { const k = key(n); if (!k || /^#?\d+$/.test(k) || /^(opp|player|penalty try)/.test(k)) return null; let o = P.get(k); if (!o){ o = {n:String(n).trim(), t:0, p:0, a:new Set(), team:new Set()}; P.set(k, o); } return o; };
  list.forEach(m => { const us = usOf(m); if (!us) return; const tc = teamCode(m.team);
    (Array.isArray(m.players) ? m.players : []).forEach(x => { const o = get(x && x.name); if (o){ o.a.add(m.id); if (tc) o.team.add(tc); } });
    (m.events || []).forEach(e => { if (e.s !== us || e.k === 'note' || !e.p) return; const o = get(e.p); if (!o) return; o.a.add(m.id); if (tc) o.team.add(tc); if (e.k === 'try' && !e.miss) o.t++; o.p += ptsOf(e); }); });
  const all = [...P.values()]; if (!all.length) return '';
  const top = (f, lab) => { const l = all.filter(o => f(o) > 0).sort((a, b) => f(b) - f(a) || a.n.localeCompare(b.n)).slice(0, 8); if (!l.length) return '';
    let rank = 0, prev = null; return `<div class="lb"><h4>${lab}</h4><ol>${l.map((o, i) => { if (f(o) !== prev){ rank = i + 1; prev = f(o); } return `<li${rank === 1 ? ' class="first"' : ''}><span class="lb-r">${rank}</span><span class="lb-n">${esc(o.n)}${!V.team && o.team.size ? ` <small>${esc([...o.team].join(' · '))}</small>` : ''}</span><b>${f(o)}</b></li>`; }).join('')}</ol></div>`; };
  const boards = [top(o => o.t, 'Top try scorers'), top(o => o.p, 'Most points'), top(o => o.a.size, 'Most appearances')].filter(Boolean);
  if (!boards.length) return '';
  const noLists = !list.some(m => Array.isArray(m.players) && m.players.length);
  return `<div class="sec">Leaderboards${V.team ? ' · ' + esc(V.team) : ''}${V.season ? ' · ' + seasonLabel(V.season) : ''}</div><div class="lbs">${boards.join('')}</div>${noLists ? '<p class="hint">Appearances count players named in a match’s team list, plus anyone who scored. Paste the squad into each match (Edit details) to count everyone who played.</p>' : ''}`;
}
function viewResults(){
  const ftAll = DATA.matches.filter(m => m.status === 'FT').sort((a, b) => kot(b) - kot(a));
  if (!ftAll.some(m => resultOf(m))) return '<div class="empty">No results yet.</div>';
  const seasons = [...new Set(ftAll.filter(m => resultOf(m)).map(seasonOf).filter(Boolean))].sort((a, b) => b - a);
  if (V.season && !seasons.includes(V.season)) V.season = 0;
  const sChips = seasons.length > 1 || V.season ? `<div class="team-tabs season-tabs" role="tablist" aria-label="Season"><span class="tt-l">Season</span>${[0].concat(seasons).map(y => `<button type="button" role="tab" data-season="${y}" aria-pressed="${(V.season || 0) === y}">${y ? seasonLabel(y) : 'All seasons'}</button>`).join('')}</div>` : '';
  // quick time filters: the past 7 or 30 days (they work together with the season and team)
  const PERIODS = [['', 'Any time'], ['week', 'Past week'], ['month', 'Past month']], since = V.period === 'week' ? Date.now() - 7*864e5 : V.period === 'month' ? Date.now() - 31*864e5 : 0;
  const pChips = `<div class="team-tabs period-tabs" role="tablist" aria-label="When"><span class="tt-l">When</span>${PERIODS.map(([k, t]) => `<button type="button" role="tab" data-period="${k}" aria-pressed="${(V.period || '') === k}">${t}</button>`).join('')}</div>`;
  const allRes = (V.season ? ftAll.filter(m => seasonOf(m) === V.season) : ftAll).filter(m => !since || kot(m) >= since);
  const counts = {}; allRes.forEach(m => { if (resultOf(m)){ const c = teamCode(m.team) || 'Other'; counts[c] = (counts[c] || 0) + 1; } });
  const codes = TEAM_CODES.concat(counts.Other ? ['Other'] : []);
  if (V.team && !codes.includes(V.team)) V.team = '';
  const chips = pChips + sChips + `<div class="team-tabs" role="tablist" aria-label="Team"><span class="tt-l">Team</span>${[''].concat(codes).map(c => `<button type="button" role="tab" data-team="${esc(c)}" aria-pressed="${(V.team || '') === c}" ${c && !counts[c] ? 'class="none"' : ''} title="${esc(c ? TEAM_NAMES[c] || 'Other teams' : 'All teams')}">${esc(c || 'All')}${c && counts[c] ? ` <small>${counts[c]}</small>` : ''}</button>`).join('')}</div>`;
  const anyF = V.team || V.season || V.period || V.res, clearB = anyF ? '<button type="button" class="clr-f" data-clear="results">✕ Clear filters</button>' : '';
  const resT = V.team ? allRes.filter(m => (teamCode(m.team) || 'Other') === V.team) : allRes, rsT = resT.map(m => [m, resultOf(m)]).filter(x => x[1]);
  const rs = V.res ? rsT.filter(x => x[1].r === V.res) : rsT, res = rs.map(x => x[0]);
  const whenTxt = V.period === 'week' ? ' in the past week' : V.period === 'month' ? ' in the past month' : V.season ? ' in ' + seasonLabel(V.season) : '';
  if (!rsT.length) return chips + clearB + `<div class="empty">No ${V.team ? esc(TEAM_NAMES[V.team] || V.team) + ' ' : ''}results${whenTxt} yet.</div>`;
  // season by season for one team: the same team each year, or one year group as it moves up
  let prog = '';
  const squad = COACH || PLAYER;   // the school-by-school record and season history are for coaches and players only
  if (squad && V.team && V.team !== 'Other'){
    const ci = COHORT.indexOf(V.team) < 4 ? COHORT.indexOf(V.team) : -1, cohort = ci >= 0 && V.prog === 'cohort', base = V.season || seasons[0];
    const rowsP = seasons.slice().sort((a, b) => a - b).map(y => { const code = cohort ? COHORT[ci + (y - base)] : V.team; if (!code) return null;
      const list = ftAll.filter(m => seasonOf(m) === y && teamCode(m.team) === code).map(resultOf).filter(Boolean); if (!list.length) return null;
      const w = list.filter(r => r.r === 'W').length, l = list.filter(r => r.r === 'L').length, f = list.reduce((a, r) => a + r.f, 0), g = list.reduce((a, r) => a + r.g, 0);
      return `<tr${y === V.season ? ' class="on"' : ''}><td><button type="button" class="lnk" data-season="${y}">${seasonLabel(y)}</button></td>${cohort ? `<td>${esc(code)}</td>` : ''}<td>${list.length}</td><td>${w}</td><td>${list.length - w - l}</td><td>${l}</td><td class="hide-s">${f}</td><td class="hide-s">${g}</td><td>${Math.round(w/list.length*100)}%</td></tr>`; }).filter(Boolean);
    if (rowsP.length){
      prog = `<div class="sec">Season by season${cohort ? ' · this year group' : ' · ' + esc(V.team)}</div>
      ${ci >= 0 ? `<div class="seg prog-seg" role="group" aria-label="Follow"><button type="button" data-prog="team" aria-pressed="${!cohort}">Same team each year</button><button type="button" data-prog="cohort" aria-pressed="${cohort}">Follow this year group</button></div>${cohort ? `<p class="hint">The ${esc(TEAM_NAMES[V.team])} of ${seasonLabel(base)}, followed as they move up a team each season (U12 → U13 → U14 → Meds → 1st XV).</p>` : ''}` : ''}
      <div class="tbl"><table><thead><tr><th>Season</th>${cohort ? '<th>Team</th>' : ''}<th>P</th><th>W</th><th>D</th><th>L</th><th class="hide-s">For</th><th class="hide-s">Against</th><th>Won</th></tr></thead><tbody>${rowsP.join('')}</tbody></table></div>`;
    }
  }
  const W = rsT.filter(x => x[1].r === 'W').length, L = rsT.filter(x => x[1].r === 'L').length, D = rsT.length - W - L;
  const sumB = (k, n, t, cls) => `<button type="button" class="${cls}${V.res === k ? ' on' : ''}" data-res="${k}" aria-pressed="${V.res === k}" title="${k ? (V.res === k ? 'Show all results' : 'Show only matches ' + t.toLowerCase()) : 'Show all results'}"><b>${n}</b><span>${t}</span></button>`;
  const RES_T = {W:'won', D:'drawn', L:'lost'};
  const by = new Map(); rsT.forEach(([m, r]) => { const k = schoolKey(r.opp) || r.opp, o = by.get(k) || {n:r.opp, p:0, w:0, d:0, l:0, f:0, a:0}; o.p++; o[r.r.toLowerCase()]++; o.f += r.f; o.a += r.g; by.set(k, o); });
  return chips + `${V.team || V.season || V.period ? `<div class="team-h">${esc(V.team ? TEAM_NAMES[V.team] || 'Other teams' : 'All teams')}${V.period === 'week' ? ' · past week' : V.period === 'month' ? ' · past month' : ''}${V.season ? ' · ' + seasonLabel(V.season) : ''}</div>` : ''}${clearB}<div class="sum sum-f">${sumB('', rsT.length, 'Played', '')}${sumB('W', W, 'Won', 'w')}${sumB('D', D, 'Drawn', '')}${sumB('L', L, 'Lost', 'l')}</div>
    <div class="sec">${V.res ? 'Matches ' + RES_T[V.res] : 'Results'}<span class="sec-hint">${V.res ? '' : 'Tap Won, Drawn or Lost to filter'}</span></div>${res.length ? `<div class="list">${res.map(row).join('')}</div>` : `<div class="empty">No matches ${RES_T[V.res]}.</div>`}
    ${squad ? leaders(resT) : ''}${prog}${squad ? `<div class="sec">Record against each school${V.team ? ' · ' + esc(V.team) : ''}${V.season ? ' · ' + seasonLabel(V.season) : ''}</div>
    <div class="tbl"><table><thead><tr><th>School</th><th>P</th><th>W</th><th>D</th><th>L</th><th class="hide-s">For</th><th class="hide-s">Against</th></tr></thead><tbody>
    ${[...by.values()].sort((a, b) => b.p - a.p || a.n.localeCompare(b.n)).map(o => `<tr><td><span class="who">${crest(o.n)}${esc(o.n)}</span></td><td>${o.p}</td><td>${o.w}</td><td>${o.d}</td><td>${o.l}</td><td class="hide-s">${o.f}</td><td class="hide-s">${o.a}</td></tr>`).join('')}</tbody></table></div>` : `<p class="hint squad-note">Coaches and players can sign in to see the record against each school.</p>`}`;
}
/* ---------- match summary image: one tap after the match, ready for WhatsApp ---------- */
const loadImg = src => new Promise(res => { if (!src) return res(null); const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; setTimeout(() => res(null), 4000); });
async function summaryCanvas(m){
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const [h, a] = score(m), us = usOf(m), f = us === 'H' ? h : a, o = us === 'H' ? a : h, res = !us ? '' : f > o ? 'WIN' : f < o ? 'LOSS' : 'DRAW', resCol = res === 'WIN' ? '#3FBF6F' : res === 'LOSS' ? '#E5484D' : '#DCC08A';
  const font = (w, sz, fam) => `${w} ${sz}px ${fam || "'Barlow Condensed','Arial Narrow',Arial,sans-serif"}`;
  const fit = (txt, w, sz, maxW) => { g.font = font(w, sz); while (g.measureText(txt).width > maxW && sz > 18){ sz -= 2; g.font = font(w, sz); } return sz; };
  // background
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#16204A'); bg.addColorStop(1, '#0A0F26'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.03)'; for (let x = -H; x < W; x += 60){ g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.lineTo(x + H + 24, H); g.lineTo(x + 24, 0); g.fill(); }
  g.fillStyle = '#DCC08A'; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
  // header
  g.textAlign = 'center'; g.fillStyle = '#DCC08A'; g.font = font(700, 34); g.fillText('FULL TIME' + (m.team ? ' · ' + String(m.team).toUpperCase() : ''), W/2, 92);
  g.fillStyle = 'rgba(255,255,255,.7)'; g.font = font(500, 28, 'Arial,sans-serif'); g.fillText([m.comp, kot(m) ? new Date(kot(m)).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short', year:'numeric'}) : '', m.venue].filter(Boolean).join('  ·  '), W/2, 138);
  // crests and names
  const [ih, ia] = await Promise.all([loadImg((school(m.home) || {}).crest), loadImg((school(m.away) || {}).crest)]);
  const side = (im, name, x) => { const R = 120; g.save(); g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.arc(x, 330, R + 18, 0, Math.PI*2); g.fill(); g.restore();
    if (im){ try { const k = Math.min(2*R/im.width, 2*R/im.height); g.drawImage(im, x - im.width*k/2, 330 - im.height*k/2, im.width*k, im.height*k); } catch(e){} }
    else { g.fillStyle = '#2A3566'; g.beginPath(); g.arc(x, 330, R, 0, Math.PI*2); g.fill(); g.fillStyle = '#fff'; g.font = font(800, 76); g.fillText(String(name).replace(/[^A-Za-z ]/g, '').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase(), x, 356); }
    const sz = fit(String(name).toUpperCase(), 700, 40, 400); g.fillStyle = '#fff'; g.font = font(700, sz); g.fillText(String(name).toUpperCase(), x, 520); };
  side(ih, m.home, 250); side(ia, m.away, W - 250);
  // score
  g.fillStyle = '#fff'; g.font = font(900, 190, "Impact,'Arial Black',sans-serif"); g.fillText(`${h}`, W/2 - 150, 700); g.fillText(`${a}`, W/2 + 150, 700);
  g.fillStyle = 'rgba(255,255,255,.4)'; g.font = font(900, 120, "Impact,'Arial Black',sans-serif"); g.fillText('–', W/2, 690);
  if (res){ g.fillStyle = resCol; const tw = 220; g.beginPath(); g.roundRect ? g.roundRect(W/2 - tw/2, 740, tw, 64, 32) : g.rect(W/2 - tw/2, 740, tw, 64); g.fill(); g.fillStyle = res === 'DRAW' ? '#111318' : '#fff'; g.font = font(800, 40); g.fillText(res, W/2, 786); }
  // scorers, one column per team
  const col = (s, x) => { const ev = sorted(m).filter(e => e.s === s && !e.miss && ['try', 'pt', 'con', 'pen', 'dg'].includes(e.k)), by = {};
    ev.forEach(e => { const k = e.k === 'pt' ? 'try' : e.k, n = (e.p || '').replace(/^\s*#?\d{1,2}[.)]?\s+/, '').trim() || '—'; by[k] = by[k] || {}; (by[k][n] = by[k][n] || []).push(e.m); });
    let y = 880; g.textAlign = 'center';
    [['try', 'TRIES'], ['con', 'CONVERSIONS'], ['pen', 'PENALTIES'], ['dg', 'DROP GOALS']].forEach(([k, t]) => { if (!by[k]) return; g.fillStyle = '#DCC08A'; g.font = font(700, 26); g.fillText(t, x, y); y += 38;
      Object.entries(by[k]).forEach(([n, mins]) => { if (y > H - 120) return; const line = `${n}${mins.length > 1 ? ' ×' + mins.length : ''}${mins.some(v => v) ? '  ' + mins.filter(Boolean).map(v => v + '′').join(' ') : ''}`; g.fillStyle = '#fff'; const sz = fit(line, 600, 30, 440); g.font = font(600, sz); g.fillText(line, x, y); y += 36; }); y += 14; });
    if (!ev.length){ g.fillStyle = 'rgba(255,255,255,.35)'; g.font = font(600, 28); g.fillText('No scores', x, y); } };
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(W/2 - 1, 850, 2, 330); col('H', 270); col('A', W - 270);
  // footer
  g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.55)'; g.font = font(600, 26); g.fillText('ERGS RUGBY  ·  popcorn483.github.io/ergs', W/2, H - 44);
  if (DATA.crest){ const cr = await loadImg(DATA.crest); if (cr){ try { g.drawImage(cr, 40, H - 110, 70, 70*cr.height/cr.width); } catch(e){} } }
  return c;
}
/* share one match: its own link (opens straight onto the match), with the score or kick-off in the message */
function matchShareText(m){
  const [h, a] = score(m), tm = m.team ? m.team + ' ' : '', line = `${m.home} ${h}–${a} ${m.away}`;
  if (isLive(m)) return `🔴 LIVE${m.status === 'HT' ? ' (half-time)' : ` ${minuteNow(m)}′`}: ERGS ${tm}· ${line}. Follow it live on ERGS Live 🏉`;
  if (m.status === 'FT') return `Full time: ERGS ${tm}· ${line} 🏉`;
  if (m.off) return `ERGS ${tm}v ${usOf(m) === 'A' ? m.home : m.away} is ${m.off === 'cancelled' ? 'cancelled' : 'postponed'}${m.offWhy ? ': ' + m.offWhy : ''}.`;
  const t = kot(m), d = t ? new Date(t) : null;
  return `ERGS ${tm}${usOf(m) === 'A' ? '@ ' + m.home : 'v ' + m.away}${d ? ' · ' + d.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}) + (m.koTbc ? ', time TBC' : ', ' + d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})) : ''}. Follow it live on ERGS Live 🏉`;
}
function shareMatch(m){
  const opp = usOf(m) === 'A' ? m.home : m.away, text = matchShareText(m), label = `${m.team ? m.team + ' ' : 'ERGS '}v ${opp || 'opposition'}`;
  window.ERGSShare.open({title:'Share this match', crest:DATA.crest, items:[{label, url:LIVE_URL + '#m.' + m.id, file:'ergs-match-qr', desc:text + ' The link opens straight onto this match.', shareText:text}]});
}
async function shareSummary(m){
  toast('Making the summary…'); let c; try { c = await summaryCanvas(m); } catch(e){ toast('That didn’t work on this device.'); return; }
  const blob = await new Promise(r => c.toBlob(r, 'image/png')), us = usOf(m), opp = us === 'A' ? m.home : m.away, [h, a] = score(m);
  const name = `ERGS-${(m.team || 'match').replace(/\W+/g, '')}-v-${String(opp || '').replace(/\W+/g, '')}.png`, file = new File([blob], name, {type:'image/png'}), text = `ERGS ${m.team || ''} ${h}–${a} ${opp ? (us === 'A' ? 'at ' : 'v ') + opp : ''}`.replace(/\s+/g, ' ').trim();
  openDialog(`<h2>Match summary</h2><img class="sum-img" alt="Match summary picture" src="${URL.createObjectURL(blob)}"><div class="dlg-a"><button type="button" class="btn" id="sumSave">Save picture</button><span style="flex:1"></span><button type="button" class="btn ghost" data-close>Close</button><button type="button" class="btn primary" id="sumShare">Share to WhatsApp…</button></div>`);
  const save = () => { const u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = name; document.body.appendChild(l); l.click(); setTimeout(() => { URL.revokeObjectURL(u); l.remove(); }, 3000); };
  $('#sumSave').onclick = save;
  $('#sumShare').onclick = async () => { if (navigator.canShare && navigator.canShare({files:[file]})){ try { await navigator.share({files:[file], text}); return; } catch(e){ if (e && e.name === 'AbortError') return; } }
    save(); toast('Saved. Open WhatsApp and attach the picture.'); };
}
function coachPanel(m){
  if (!COACH || DATA.demo) return '';
  const b = (act, t, cls) => `<button type="button" class="btn ${cls || ''}" data-act="${act}">${t}</button>`;
  let clock = '';
  if (m.status === 'pre') clock = m.off ? b('reinstate', 'Match back on', 'primary') + b('offedit', 'New date or reason') : b('ko', 'Kick off', 'primary') + b('postpone', 'Postpone, cancel or move', 'ghost');
  if (m.status === '1H') clock = b('ht', 'Half time', 'primary');
  if (m.status === 'HT') clock = b('2h', 'Start 2nd half', 'primary');
  if (m.status === '2H') clock = b('ft', 'Full time', 'primary');
  if (m.status === '1H' || m.status === '2H') clock += b('pause', m.clock && m.clock.running ? 'Pause clock' : 'Restart clock') + b('minus', '−1 min', 'ghost') + b('plus', '+1 min', 'ghost');
  if (m.status === 'FT') clock = b('reopen', 'Reopen match');
  const pad = ['H', 'A'].map(s => `<div class="col"><div class="side-h">${crest(s === 'H' ? m.home : m.away)}<span>${esc(s === 'H' ? m.home : m.away)}</span></div>${['try','con','pen','dg','pt','yc','rc'].map(k => `<button type="button" class="btn ${PTS[k] ? 'pts' : 'card'} ${k}" data-ev="${k}" data-side="${s}" ${m.status === 'pre' || m.status === 'FT' ? 'disabled' : ''}><span>${EVK[k][0]}</span><small>${PTS[k] ? '+' + PTS[k] : '■'}</small></button>`).join('')}</div>`).join('');
  const notes = usOf(m) ? oppNoteBox(m) : '';
  return `${m.status === 'pre' ? notes : ''}<div class="box coach"><h3>Match clock</h3><div class="ctrl">${clock}</div></div>
    <div class="box coach"><h3>Score</h3><div class="pad">${pad}</div>${m.status === 'pre' ? '<p class="hint">Press Kick off first.</p>' : ''}</div>
    <div class="box coach"><h3>Commentary</h3><form class="inline" id="noteForm"><input class="input" id="noteIn" maxlength="140" placeholder="Big turnover at the breakdown" aria-label="Commentary line"><button class="btn" type="submit">Post</button></form></div>
    ${m.status === 'FT' && usOf(m) ? `<div class="box coach"><h3>After the match</h3><p class="hint" style="margin:0">Opens the main app with the score and scorers filled in, ready to download, plus a match report draft to edit.</p><div class="ctrl"><a class="btn primary" href="${MAIN_APP}#ft.${esc(m.id)}" target="_blank" rel="noopener">Full-time graphic &amp; match report</a></div></div>` : ''}
    ${m.status === 'FT' && usOf(m) ? nomBox(m) : ''}
    ${m.status !== 'pre' ? notes : ''}
    <div class="box coach"><h3>Match</h3>${veoOf(m) || photosOf(m) ? '' : '<p class="hint" style="margin:0 0 8px">Add the VEO video and photo album links in Edit details.</p>'}<div class="ctrl">${b('edit', 'Edit details')}${b('share', 'Copy match link')}${m.status === 'FT' ? b('copyres', 'Copy result') : ''}${b('del', 'Delete match', 'ghost danger')}</div></div>`;
}
function viewMatch(m){
  const evs = sorted(m), t = [0, 0], run = new Map(); evs.forEach(e => { const p = ptsOf(e); if (e.s === 'H') t[0] += p; if (e.s === 'A') t[1] += p; run.set(e, t.join('–')); });
  const kicks = []; for (const s of ['H', 'A']){ const by = {}; evs.filter(e => e.s === s && ['con','pen','dg'].includes(e.k)).forEach(e => { const k = e.p || 'Kicker'; const r = by[k] = by[k] || [0, 0]; r[1]++; if (!e.miss) r[0]++; }); Object.entries(by).forEach(([k, r]) => kicks.push(`<div class="kick"><span>${esc(k)} <small>${esc(s === 'H' ? m.home : m.away)}</small></span><b>${r[0]}/${r[1]}</b></div>`)); }
  const canX = COACH && !DATA.demo;
  const offBox = !m.off && movedRecent(m) ? `<div class="off-ban big moved" role="status"><b>New date: ${esc(new Date(kot(m)).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'}))}${m.koTbc ? ', kick-off TBC' : ', ' + esc(new Date(kot(m)).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}))}</b><p>${esc(['Was ' + wasText(m), m.moved.why].filter(Boolean).join(' · '))}</p></div>`
    : m.off && m.status === 'pre' ? `<div class="off-ban big" role="alert"><b>This match is ${m.off === 'cancelled' ? 'cancelled' : 'postponed'}</b>${m.offWhy ? `<p>${esc(m.offWhy)}</p>` : ''}${m.off === 'postponed' ? '<p>A new date will appear here when it is arranged.</p>' : ''}</div>` : '';
  const tc = teamCode(m.team), teamBig = m.team ? `<div class="mv-team"><span class="mv-code">${esc(TEAM_CODES.includes(tc) ? tc : m.team)}</span>${TEAM_CODES.includes(tc) ? `<span class="mv-name">${esc(TEAM_NAMES[tc])}</span>` : ''}${m.comp ? `<span class="mv-comp">${esc([m.comp, m.round].filter(Boolean).join(' · '))}</span>` : ''}</div>` : '';
  const media = veoOf(m) || photosOf(m) ? `<div class="mv-media">${veoOf(m) ? `<a class="veo" href="${esc(veoOf(m))}" target="_blank" rel="noopener">▶ View on VEO</a>` : ''}${photosOf(m) ? `<a class="veo photos" href="${esc(photosOf(m))}" target="_blank" rel="noopener">${ic('photo')}Match photos</a>${COACH && !DATA.demo ? `<button type="button" class="ph-x" data-phx="${esc(m.id)}" title="Not the photos from this match? Remove the link">✕ Not this match</button>` : ''}` : ''}</div>` : '';
  const banner = (isLive(m) || m.status === 'FT' ? board(m, true) : `<div class="sb quiet"><div class="sb-meta">${esc(compLine(m))}</div><div class="sb-main"><div class="side">${crest(m.home, 'big')}<b>${esc(m.home)}</b></div><div class="score" style="font-size:40px;color:var(--dim)">v</div><div class="side">${crest(m.away, 'big')}<b>${esc(m.away)}</b></div></div><span class="clock" style="border-color:var(--rule)">${esc(when(m, true) || 'Date to be confirmed')}</span></div>`).replace(/<div class="sb-meta">[^<]*<\/div>/, s0 => { if (!teamBig) return s0; const t = [m.status === '1H' ? '1st half' : m.status === '2H' ? '2nd half' : '', isLive(m) || m.status === 'FT' ? m.venue : ''].filter(Boolean).join(' · '); return teamBig + (t ? `<div class="sb-meta">${esc(t)}</div>` : ''); }).replace(/<\/div>\s*$/, media + '</div>');
  const sumBtn = m.status === 'FT' && (COACH || PLAYER) ? `<div class="cal-one"><button type="button" class="btn primary" data-sum="${esc(m.id)}">📸 Match summary picture</button></div>` : '';
  const calOne = m.status === 'pre' && kot(m) && m.off !== 'cancelled' && kot(m) > Date.now() - 3*3600e3 ? `<div class="cal-one"><button type="button" class="btn" data-cal1="${esc(m.id)}">📅 Add to calendar</button></div>` : '';
  const wxBox = m.status === 'pre' && m.off !== 'cancelled' && kot(m) && kot(m) - Date.now() < 15.5*864e5 ? `<div class="box wx-big" data-wx="${esc(m.id)}" hidden></div>` : '';
  const shareOne = DATA.demo ? '' : `<div class="cal-one"><button type="button" class="btn" data-shm="${esc(m.id)}">${isLive(m) ? '📣 Share this match live' : '📤 Share this match'}</button></div>`;
  return `<button class="back" type="button" data-home>All matches</button>${offBox}${banner}${sumBtn}${shareOne}${calOne}${wxBox}
    ${coachPanel(m)}
    ${m.venue && m.status === 'pre' ? `<div class="box"><h3>Venue</h3><div>${esc(m.venue)}</div></div>` : ''}
    ${kicks.length ? `<div class="box"><h3>Goal kicking</h3>${kicks.join('')}</div>` : ''}
    ${evs.some(e => e.k === 'note' && e.p) ? `<div class="box commfeed"><h3><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0" fill="none" stroke="currentColor" stroke-width="2"/></svg>Live commentary</h3>
      ${evs.filter(e => e.k === 'note' && e.p).slice().reverse().slice(0, 12).map((e, i) => `<div class="cf${i === 0 ? ' latest' : ''}"><span class="cf-m">${e.m}′</span><p>${esc(e.p)}</p></div>`).join('')}</div>` : ''}
    <div class="box"><h3>Match timeline</h3>${evs.length ? `<ul class="tl">${evs.slice().reverse().map(e => `<li class="${e.miss ? 'miss' : ''}${canX ? ' x' : ''}"><span class="mn">${e.m}′</span><span class="ic ${e.k}">${e.k === 'note' ? '…' : EVK[e.k][1]}</span><span class="tx"><b>${esc(label(e))}</b> <span>${e.k === 'note' ? '' : esc(e.s === 'H' ? m.home : m.away)}</span></span><span class="run">${ptsOf(e) ? run.get(e) : ''}</span>${canX ? `<button type="button" class="rm" data-rm="${esc(e.id)}" aria-label="Remove this entry">×</button>` : ''}</li>`).join('')}</ul>` : `<p style="margin:0;color:var(--mute)">${m.status === 'pre' ? 'The timeline fills in once the match kicks off.' : 'Final score only.'}</p>`}</div>`;
}
/* supporters: anyone signed in who isn't a coach or player follows every squad, or the squads they pick (saved on their sign-in record) */
let SUP = null, LASTS;   // SUP: {follow:[team codes]} for a signed-in supporter; an empty list means every squad
const FOLLOW_LBL = {'1XV':'1st XV', '2XV':'2nd XV', '3XV':'3rd XV', U16:'U16', Meds:'Medallion', U14:'U14', U13:'U13', U12:'U12', SG:'Senior Girls', JG:'Junior Girls'};
const followTxt = l => !l || !l.length ? 'all squads' : l.map(c => FOLLOW_LBL[c] || c).join(', ');
const followOK = m => { if (SANDBOX || !SUP || !SUP.follow || !SUP.follow.length) return true; const c = teamCode(m.team);
  return !c || SUP.follow.includes(c) || m.id === V.open || location.hash === '#m.' + m.id; };   // a shared match link always opens
const reapply = () => { if (LASTS !== undefined && !SANDBOX) applyData(LASTS); };
function supBar(){
  const sb = $('#supBar'); if (!sb) return; const on = !!SUP && !COACH && !PLAYER && !SANDBOX; sb.hidden = !on; if (!on) return;
  sb.innerHTML = `<span class="cb-msg"><span class="pb-badge sup">Supporter</span>Following <b>${esc(followTxt(SUP.follow))}</b></span><button type="button" class="btn small" id="supChange">Change squads</button><button type="button" class="btn small" id="supShare">Share the app</button>`;
  $('#supChange').onclick = () => followDialog(false); $('#supShare').onclick = () => shareBtn.click();
}
function followDialog(first){
  const pick = new Set((SUP && SUP.follow) || []);
  openDialog(`<h2>${first ? 'Which squads do you follow?' : 'Squads you follow'}</h2><p>You’ll see matches, fixtures and results for these squads. Change it any time with <b>Change squads</b> at the top.</p>
    <div class="fl-grid"><button type="button" class="fl-chip fl-all" data-flall>All squads</button>${TEAM_CODES.map(c => `<button type="button" class="fl-chip" data-fl="${c}">${esc(FOLLOW_LBL[c] || c)}</button>`).join('')}</div>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>${first ? 'Later' : 'Cancel'}</button><button type="button" class="btn primary" id="flSave">Save</button></div>`, d => {
    const sync = () => { d.querySelector('[data-flall]').setAttribute('aria-pressed', !pick.size); d.querySelectorAll('[data-fl]').forEach(b => b.setAttribute('aria-pressed', pick.has(b.dataset.fl))); };
    d.querySelector('[data-flall]').onclick = () => { pick.clear(); sync(); };
    d.querySelectorAll('[data-fl]').forEach(b => b.onclick = () => { const c = b.dataset.fl; pick.has(c) ? pick.delete(c) : pick.add(c); if (pick.size === TEAM_CODES.length) pick.clear(); sync(); });
    sync();
    d.querySelector('#flSave').onclick = async () => { const list = TEAM_CODES.filter(c => pick.has(c)), btn = d.querySelector('#flSave'); btn.disabled = true;
      try { await FB.setFollow(list); SUP = {follow:list}; closeDialog(); toast(`Following ${followTxt(list)}.`); reapply(); }
      catch(e){ btn.disabled = false; toast(/permission/.test(e && e.code || '') ? 'That didn’t save: the coaches need to publish the latest Firebase rules.' : 'That didn’t save. Try again.'); } };
  });
}
async function supLoad(){
  const em = EMAIL; if (FB.noteSupporter) await FB.noteSupporter();
  const r = FB.myRequest ? await FB.myRequest() : null; if (em !== EMAIL) return;
  SUP = {follow:r && Array.isArray(r.follow) ? r.follow.filter(c => TEAM_CODES.includes(c)) : []}; reapply();
  if (!(r && Array.isArray(r.follow))){ let asked = true; try { asked = localStorage.getItem('ergs.followAsked.' + em) === '1'; localStorage.setItem('ergs.followAsked.' + em, '1'); } catch(e){}
    if (!asked && $('#modal').hidden) followDialog(true); }
}
function playerBar(){
  const pb = $('#playerBar'), on = PLAYER && !COACH; pb.hidden = !on; if (!on) return;
  pb.innerHTML = `<span class="cb-msg"><span class="pb-badge">Player</span>Signed in · videos, photos and records unlocked</span>`;
}
function coachBar(){
  playerBar(); supBar();
  sbBar();
  const bar = $('#coachBar'); bar.hidden = !COACH || SANDBOX; if (!COACH || SANDBOX) return;
  bar.innerHTML = DATA.demo
    ? `<span><b>Coach view.</b> The matches below are examples. Clear them to start real scoring; supporters will see your matches straight away.</span><button type="button" class="btn primary" data-act="cleardemo">Clear the examples</button>`
    : `<span class="cb-msg"><span class="cb-dot"></span><b>Coach view</b> · changes go live for everyone</span><div class="ctrl"><button type="button" class="btn primary" data-act="new">New match</button></div>`;
  if (READY && !HAS_DOC) bar.innerHTML = `<span><b>Coach view.</b> The scoreboard is empty. Bring across the matches from the Claude page to start.</span><button type="button" class="btn primary" data-act="seed">Set up the scoreboard</button><button type="button" class="btn ghost" data-act="signout">Sign out</button>`;
}
function render(){
  const m = V.open && DATA.matches.find(x => x.id === V.open);
  if (V.open && !m && !(Date.now() - (V.openAt || 0) < 6000)) V.open = null;
  $('#demoBar').hidden = !DATA.demo || COACH;
  const lp = document.querySelector('.hd-r .pill.live'); if (lp) lp.hidden = !DATA.matches.some(isLive);
  coachBar();
  $('#tabs').hidden = !!m;
  $$('#tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === V.tab));
  $('#view').innerHTML = m ? viewMatch(m) : V.tab === 'fixtures' ? viewFixtures() : V.tab === 'results' ? viewResults() : V.tab === 'cup' ? viewCup() : viewMatches();
  $$('[data-unbin]').forEach(b => b.onclick = ev => { ev.stopPropagation(); const id = b.dataset.unbin; save(d => { const x = d.matches.find(y => y.id === m.id); const e = x && x.events.find(y => y.id === id); if (e) e.ret = Date.now(); }, m.id); });
  $$('[data-team]').forEach(b => b.onclick = () => { V.team = b.dataset.team; render(); });
  $$('[data-season]').forEach(b => b.onclick = () => { V.season = +b.dataset.season || 0; render(); });
  $$('[data-period]').forEach(b => b.onclick = () => { V.period = b.dataset.period; render(); });
  $$('[data-lperiod]').forEach(b => b.onclick = () => { V.lPeriod = b.dataset.lperiod; render(); });
  const lt = $('#lrTeam'); if (lt) lt.onchange = () => { V.lTeam = lt.value; render(); };
  $$('[data-prog]').forEach(b => b.onclick = () => { V.prog = b.dataset.prog; render(); });
  $$('[data-phx]').forEach(b => b.onclick = () => ask('Remove the photos link?', 'The photos link comes off this match for everyone. It won’t be added back automatically. You can add a link again in Edit details.', 'Remove', () => FB.setPhotos(b.dataset.phx, PHOTO_NONE).then(() => toast('Photos link removed from this match.')).catch(() => toast('That didn’t save. Try again.'))));
  $$('[data-res]').forEach(b => b.onclick = () => { V.res = V.res === b.dataset.res ? '' : b.dataset.res; render(); });
  $$('[data-clear]').forEach(b => b.onclick = () => { if (b.dataset.clear === 'latest'){ V.lPeriod = ''; V.lTeam = ''; } else { V.team = ''; V.season = 0; V.period = ''; V.res = ''; } render(); });
  { const nm = $('.cal-m.now'); if (nm && !V.calJumped && innerWidth < 760){ V.calJumped = true; setTimeout(() => nm.scrollIntoView({block:'start', behavior:'smooth'}), 60); } }   // phones open on this month
  wxFill();
  $$('[data-fxclear]').forEach(b => b.onclick = () => { V.ha = ''; V.calTeams.clear(); try { localStorage.setItem('ergs.calTeams', '[]'); } catch(e){} render(); });
  $$('[data-ha]').forEach(b => b.onclick = () => { V.ha = b.dataset.ha; V.calDay = ''; render(); });
  $$('[data-fxv]').forEach(b => b.onclick = () => { V.calJumped = false; V.fxView = b.dataset.fxv; try { localStorage.setItem('ergs.fxView', V.fxView); } catch(e){} render(); });
  $$('[data-calt]').forEach(b => b.onclick = () => { const t = b.dataset.calt; if (!t) V.calTeams.clear(); else V.calTeams.has(t) ? V.calTeams.delete(t) : V.calTeams.add(t); V.calDay = ''; try { localStorage.setItem('ergs.calTeams', JSON.stringify([...V.calTeams])); } catch(e){} render(); });
  $$('[data-cald]').forEach(b => b.onclick = () => { V.calDay = V.calDay === b.dataset.cald ? '' : b.dataset.cald; render(); const d = $('#calDay'); if (d) d.scrollIntoView({behavior:'smooth', block:'nearest'}); });
  $$('[data-shm]').forEach(b => b.onclick = () => { const x = DATA.matches.find(y => y.id === b.dataset.shm); if (x) shareMatch(x); });
  $$('[data-sum]').forEach(b => b.onclick = () => { const x = DATA.matches.find(y => y.id === b.dataset.sum); if (x) shareSummary(x); });
  $$('[data-cal1]').forEach(b => b.onclick = () => { const x = DATA.matches.find(y => y.id === b.dataset.cal1); if (x) calIcs([x], 'ergs-match.ics'); });
  { const ct = $('#calTeam'); if (ct) ct.onchange = () => { V.calTeam = ct.value; render(); }; }
  $$('[data-calall]').forEach(b => b.onclick = () => { const now = Date.now(), list = DATA.matches.filter(m => m.status !== 'FT' && m.off !== 'cancelled' && kot(m) > now - 3*3600e3 && haOK(m) && tmOK(m)); calIcs(list, 'ergs-fixtures.ics'); });
  $$('[data-tabgo]').forEach(b => b.onclick = () => { V.tab = b.dataset.tabgo; render(); scrollTo(0, 0); });
  $$('[data-more]').forEach(b => b.onclick = () => { V['more' + b.dataset.more] = !V['more' + b.dataset.more]; render(); });
  $$('[data-open]').forEach(b => b.onclick = () => { V.open = b.dataset.open; try { history.replaceState(null, '', '#m.' + V.open); } catch(e){} render(); scrollTo(0, 0); });
  $$('[data-home]').forEach(b => b.onclick = () => { V.open = null; try { history.replaceState(null, '', location.pathname + location.search); } catch(e){} render(); });
  $$('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, m));
  $$('[data-ev]').forEach(b => b.onclick = () => openEv(m, b.dataset.ev, b.dataset.side));
  $$('[data-rm]').forEach(b => b.onclick = () => { const e = m.events.find(x => x.id === b.dataset.rm); ask('Remove this entry?', `${label(e)} at ${e.m}′ will come off the timeline and the score for everyone.`, 'Remove', () => save(d => { const x = d.matches.find(y => y.id === m.id); x.events = x.events.filter(y => y.id !== e.id); }, m.id)); });
  const nf = $('#noteForm'); if (nf) nf.onsubmit = ev => { ev.preventDefault(); const t = $('#noteIn').value.trim(); if (!t) return; save(d => { const x = d.matches.find(y => y.id === m.id); x.events.push({id:uid(), k:'note', s:'', p:t.slice(0, 140), m:minuteNow(m), at:Math.round(elapsed(m)), ts:Date.now()}); }, m.id); };
  const onf = $('#oppNoteForm'); if (onf) onf.onsubmit = async ev => { ev.preventDefault(); const opp = onf.dataset.opp, k = oppKey(opp), t = $('#oppNoteIn').value.trim();
    try { await FB.setOppNote(k, t ? {name:opp, text:t.slice(0, 4000), u:Date.now(), by:EMAIL} : null); toast(t ? `Notes on ${opp} saved. Only coaches can see them.` : `Notes on ${opp} removed.`); } catch(e){ toast(/permission/.test(e && e.code || '') ? 'The database refused the save: your account isn’t on the coaches list.' : 'That didn’t save. Try again.'); } };
  const vf = $('#veoForm'); if (vf) vf.onsubmit = async ev => { ev.preventDefault(); const v = $('#veoIn').value.trim(); if (v && !/^https:\/\//i.test(v)){ toast('Paste the full link, starting with https://'); return; }
    try { await FB.setVeo(m.id, v); if (m.veo) await save(d => { delete d.matches.find(y => y.id === m.id).veo; }, m.id); toast(v ? 'VEO link saved. Coaches and players can watch it.' : 'VEO link removed.'); } catch(e){ toast('That didn’t save. Try again.'); } };
  const pf = $('#photoForm'); if (pf) pf.onsubmit = ev => { ev.preventDefault(); const v = $('#photoIn').value.trim(); if (v && !/^https:\/\//i.test(v)){ toast('Paste the full link, starting with https://'); return; } FB.setPhotos(m.id, v).then(async () => { if (m.photos) await save(d => { delete d.matches.find(y => y.id === m.id).photos; }, m.id); toast(v ? 'Photos link saved. Coaches and players can open it.' : 'Photos link removed.'); }).catch(() => toast('That didn’t save. Try again.')); };
}
$$('#tabs button').forEach(b => b.onclick = () => { V.tab = b.dataset.v; render(); });
setInterval(() => {
  $$('[data-clock]').forEach(el => { const m = DATA.matches.find(x => x.id === el.dataset.clock); if (m){ const t = clockText(m); if (el.textContent !== t) el.textContent = t; } });
  $$('[data-bin]').forEach(el => { const [mid, eid] = el.dataset.bin.split('|'), m = DATA.matches.find(x => x.id === mid), e = m && m.events.find(x => x.id === eid); if (m && e) el.textContent = mm((e.at || 0) + (m.code === 'sevens' ? 120 : 600) - elapsed(m)); });
}, 1000);

/* ---------- saving: a transaction on the shared scoreboard; every phone gets it within a second ---------- */
let NOMS = [], nomsUnsub = null, OPPN = {}, notesUnsub = null;
let saving = false, READY = false, HAS_DOC = false, EMAIL = '', ADMIN = false, PLAYER = false, VEO = {}, PHOTOS = {}, veoUnsub = null;
/* VEO links are kept in a private record only coaches and players can read; older ones may still sit on the match */
const veoOf = m => (COACH || PLAYER) ? (VEO[m.id] || m.veo || '') : '';
const PHOTO_NONE = 'none';   // a coach said "these photos aren't from this match": stops the automatic link
let PHOTO_AUTO = {};
const photosOf = m => (COACH || PLAYER) ? (PHOTOS[m.id] === PHOTO_NONE ? '' : PHOTOS[m.id] || m.photos || PHOTO_AUTO[m.id] || '') : '';
/* ---------- match photos found automatically: a folder in the season's photo Drive named with the school and the date ---------- */
const MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
function folderDate(name, seasonY){
  const x = String(name || '').toLowerCase(); let d, mo, y, mt;
  if ((mt = x.match(/\b(20\d\d)[-_. ](\d{1,2})[-_. ](\d{1,2})\b/))){ y = +mt[1]; mo = +mt[2]; d = +mt[3]; }
  else if ((mt = x.match(/\b(\d{1,2})[-_./](\d{1,2})(?:[-_./](\d{2,4}))?\b/))){ d = +mt[1]; mo = +mt[2]; y = mt[3] ? +mt[3] : 0; }
  else if ((mt = x.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?(?:\s*(\d{2,4}))?\b/))){ d = +mt[1]; mo = MON[mt[2]]; y = mt[3] ? +mt[3] : 0; }
  else if ((mt = x.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/))){ mo = MON[mt[1]]; d = +mt[2]; y = mt[3] ? +mt[3] : 0; }
  if (!d || !mo || mo > 12 || d > 31) return '';
  if (y && y < 100) y += 2000; if (!y) y = seasonY ? (mo >= 8 ? seasonY : seasonY + 1) : new Date().getFullYear();
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const NAME_SKIP = /^(the|of|and|school|college|grammar|academy|high|royal|st|saint|collegiate|integrated|secondary|boys|girls|rugby|club|county|park|u1\d|xv|1st|2nd|3rd|photos?|v|vs)$/;
function schoolInName(opp, name){
  const x = ' ' + String(name || '').toLowerCase().replace(/[’'`.]/g, '').replace(/[^a-z0-9]+/g, ' ') + ' ', c = canonSchool(opp);
  const nicks = Object.keys(SCHOOL_NICKNAMES).filter(k => SCHOOL_NICKNAMES[k] === c);
  if (nicks.some(k => x.includes(' ' + k + ' '))) return true;
  const words = c.toLowerCase().replace(/[’'`.]/g, '').split(/[^a-z0-9]+/).filter(w => w && w.length > 2 && !NAME_SKIP.test(w));
  return !!words.length && x.includes(' ' + words[0] + ' ');
}
let phScanAt = 0, phScanning = false;
async function photoScan(force){
  if (!(COACH || PLAYER) || SANDBOX || !window.FB || !FB.teamDoc || phScanning) return; if (!force && Date.now() - phScanAt < 10*60e3) return;
  const key = CFG.driveKey || (CFG.firebase || {}).apiKey; if (!key) return;
  phScanning = true; phScanAt = Date.now();
  try {
    const pd = await FB.teamDoc('photos'), seasons = (pd && Array.isArray(pd.seasons) ? pd.seasons : []).filter(x => x && x.folder), hidden = (pd && pd.hidden) || {};
    const list = async id => { const q = encodeURIComponent(`'${id}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`);
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&key=${encodeURIComponent(key)}`); if (!r.ok) return []; return ((await r.json()).files || []).filter(f => !hidden[f.id]); };
    const found = [];
    for (const s of seasons){ const sy = +(String(s.label || '').match(/20\d\d/) || [0])[0];
      for (const f of await list(s.folder)){ const dt = folderDate(f.name, sy);
        if (dt) found.push({id:f.id, name:f.name, d:dt});
        else for (const g of (await list(f.id)).slice(0, 80)){ const d2 = folderDate(g.name, sy); if (d2) found.push({id:g.id, name:f.name + ' ' + g.name, d:d2}); } } }
    const auto = {}, ours = DATA.matches.filter(m => usOf(m) && kot(m));
    for (const f of found){
      const day = ours.filter(m => ymd(new Date(kot(m))) === f.d); if (!day.length) continue;
      let hit = day.filter(m => schoolInName(usOf(m) === 'A' ? m.home : m.away, f.name));
      if (!hit.length && day.length === 1) hit = day;   // only one match that day: the date is enough
      const tc = teamCode(f.name); if (hit.length > 1 && TEAM_CODES.includes(tc)){ const t2 = hit.filter(m => teamCode(m.team) === tc); if (t2.length) hit = t2; }
      hit.forEach(m => { if (!auto[m.id]) auto[m.id] = 'https://drive.google.com/drive/folders/' + f.id; });
    }
    const was = JSON.stringify(PHOTO_AUTO); PHOTO_AUTO = auto; if (JSON.stringify(auto) !== was && READY && $('#modal').hidden) render();
  } catch(e){} finally { phScanning = false; }
}
setInterval(() => photoScan(), 60e3);
async function save(fn, keepOpen){
  if (!COACH || !window.FB || saving) return;
  if (keepOpen !== undefined){ V.open = keepOpen; V.openAt = Date.now(); }
  saving = true; const t = setTimeout(() => { if (saving) $('#saving').hidden = false; }, 400);
  try { await FB.save(cur => { const next = clone(cur || {matches:[], schools:{}}); fn(next); next.updated = Date.now(); return next; }); }
  catch(e){ const c = e && (e.code || '');
    if (/permission/.test(c)){ toast(ADMIN ? `The database refused the save. In Firebase → Firestore → Rules, check the admin email reads ${CFG.admin} and press Publish.` : 'The database refused the save: your account isn’t on the coaches list. Ask the admin to add you.'); }
    else if (/unavailable|network/.test(c)) toast('No signal. That change didn’t save; try again.');
    else toast('That didn’t save. Try again.'); console.error(e); }
  finally { clearTimeout(t); saving = false; $('#saving').hidden = true; render(); }
}

/* ---------- dialogs ---------- */
function openDialog(html, onOpen){ $('#dialog').innerHTML = html; $('#modal').hidden = false; $$('#dialog [data-close]').forEach(b => b.onclick = closeDialog); if (onOpen) onOpen($('#dialog')); const f = $('#dialog input, #dialog button.btn.primary'); f && f.focus(); }
function closeDialog(){ $('#modal').hidden = true; $('#dialog').innerHTML = ''; if (pendingRender){ pendingRender = false; render(); } }
let pendingRender = false;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeDialog(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeDialog(); });
function ask(title, text, ok, fn){ openDialog(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="dlg-a"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="askOk">${esc(ok)}</button></div>`, d => d.querySelector('#askOk').onclick = () => { closeDialog(); fn(); }); }
function seg(name, opts, val){ return `<div class="seg" data-seg="${name}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${v === val}">${t}</button>`).join('')}</div>`; }
function wireSegs(d){ d.querySelectorAll('[data-seg]').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => { s.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); s.dataset.val = b.dataset.v; s.dispatchEvent(new Event('change')); })); d.querySelectorAll('[data-seg]').forEach(s => { const p = s.querySelector('[aria-pressed="true"]'); s.dataset.val = p ? p.dataset.v : ''; }); }

/* scoring */
/* team sheets from the main app, so the scorer always has the right names */
let TEAMS_CACHE = null, teamsAt = 0;
async function loadTeams(force){ if (!window.FB || !FB.listTeams || !COACH) return null; if (TEAMS_CACHE && !force && Date.now() - teamsAt < 60000) return TEAMS_CACHE;
  try { TEAMS_CACHE = await FB.listTeams(); teamsAt = Date.now(); } catch(e){} return TEAMS_CACHE; }
const sheetPlayers = x => (x.players || []).map((p, i) => ({n:+p.n || i + 1, name:((p.f || '') + ' ' + (p.l || '')).trim()})).filter(p => p.name).sort((a, b) => a.n - b.n);
const sheetLabel = x => (x.title || [x.team, x.opp ? 'v ' + x.opp : ''].filter(Boolean).join(' ') || 'Team sheet') + (x.date ? ' · ' + new Date(x.date + 'T12:00').toLocaleDateString('en-GB', {day:'numeric', month:'short'}) : '');
/* the sheet for this match: same opponent on the same day, else same opponent and team, else the latest sheet for that team */
function sheetFor(m){
  const T = TEAMS_CACHE; if (!T || !T.sheets.length) return null;
  const opp = canonSchool(usOf(m) === 'A' ? m.home : m.away), day = (m.ko || '').slice(0, 10), tc = teamCode(m.team);
  const sameOpp = T.sheets.filter(x => x.opp && canonSchool(x.opp) === opp);
  return sameOpp.find(x => x.date === day) || sameOpp.find(x => tc && teamCode(x.team) === tc) || T.sheets.find(x => tc && teamCode(x.team) === tc && x.date === day) || null;
}
function openEv(m, k, s, pending){
  const team = s === 'H' ? m.home : m.away, kick = k === 'con' || k === 'pen' || k === 'dg', after = !!pending;
  const ours = usOf(m) === s;
  let players = ours && Array.isArray(m.players) && m.players.length ? m.players : [];
  if (ours && !players.length && COACH){
    if (!TEAMS_CACHE){ loadTeams().then(() => openEv(m, k, s, pending)); return; }
    const x = (m.sheetId && TEAMS_CACHE.sheets.find(y => y.id === m.sheetId)) || sheetFor(m); if (x) players = sheetPlayers(x);
  }
  const used = new Set(); sorted(m).forEach(e => { if (e.s === s && e.p && e.k !== 'note') used.add(e.p); });
  const lastKicker = kick ? sorted(m).filter(e => e.s === s && (e.k === 'con' || e.k === 'pen') && e.p).pop() : null;
  openDialog(`<h2>${after ? 'Conversion attempt' : EVK[k][0]}</h2><p>${esc(team)}${PTS[k] ? ` · +${PTS[k]} if scored` : ''}</p>
    ${kick ? `<div class="field"><span class="label">Kick</span>${seg('res', [['ok','Scored'],['miss','Missed']], 'ok')}</div>` : ''}

    <div class="field"><label class="label" for="evWho">${kick ? 'Kicker' : 'Player'}${players.length ? ' (name or shirt number)' : ' (optional)'}</label><input class="input" id="evWho" maxlength="40" list="evNames" autocomplete="off" value="${esc(lastKicker ? lastKicker.p : '')}"><datalist id="evNames">${players.map(p => `<option value="${esc(p.name)}" label="#${esc(p.n)}">`).join('')}${[...used].filter(n => !players.some(p => p.name === n)).map(n => `<option value="${esc(n)}">`).join('')}</datalist><span class="hint" id="evHint" aria-live="polite"></span></div>
    <div class="field" style="max-width:140px"><label class="label" for="evMin">Minute</label><input class="input" id="evMin" type="number" min="0" max="120" value="${minuteNow(m)}"></div>
    <div class="dlg-a"><button type="button" class="btn ghost" id="evSkip">${after ? 'Skip' : 'Cancel'}</button>${kick ? '<button type="button" class="btn danger" id="evMiss">Missed</button>' : ''}<button type="button" class="btn primary" id="evGo">${k === 'try' ? 'Next: conversion' : kick ? 'Scored' : 'Add'}</button></div>`, d => {
    wireSegs(d);
    const byNum = v => { const n = (String(v).trim().match(/^#?(\d{1,2})$/) || [])[1]; return n ? players.find(p => +p.n === +n) : null; };
    const who = d.querySelector('#evWho'), hint = d.querySelector('#evHint');
    who.oninput = () => { const p = byNum(who.value); hint.textContent = p ? `#${p.n} ${p.name}` : /^#?\d{1,2}$/.test(who.value.trim()) && players.length ? 'No player with that number' : '';
      };
    who.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); d.querySelector('#evGo').click(); } });
    // the team list is saved with the score, so the next entry has it straight away
    const commit = list => { list.forEach(e => { if (e.p && e.s === usOf(m)) publishFace(e.p); }); return save(dd => { const x = dd.matches.find(y => y.id === m.id); list.forEach(e => x.events.push(e)); if (ours && players.length && !(x.players || []).length) x.players = players; }, m.id); };
    d.querySelector('#evSkip').onclick = () => { closeDialog(); if (after) commit(pending); };
    const mb = d.querySelector('#evMiss'); if (mb) mb.onclick = () => { const seg = d.querySelector('[data-seg="res"]'); if (seg){ seg.dataset.val = 'miss'; } d.querySelector('#evGo').click(); };
    if (kick) d.querySelector('#evGo').addEventListener('click', ev => { if (!ev.isTrusted) return; const seg = d.querySelector('[data-seg="res"]'); if (seg) seg.dataset.val = 'ok'; }, true);
    d.querySelector('#evGo').onclick = () => {
      const typed = d.querySelector('#evWho').value.trim(), hit = byNum(typed);
      const ev = {id:uid(), k, s, p:(hit ? hit.name : typed).slice(0, 40), m:Math.max(0, Math.min(120, parseInt(d.querySelector('#evMin').value, 10) || 0)), at:Math.round(elapsed(m)), ts:Date.now()};
      if (kick && d.querySelector('[data-seg="res"]').dataset.val === 'miss') ev.miss = true;
      closeDialog();
      if (k === 'try') openEv(m, 'con', s, [ev]);
      else commit((pending || []).concat([ev]));
    };
  });
}
/* match details */
const COMPS = ['Ulster Schools’ Cup','Ulster Schools’ Bowl','Ulster Schools’ Shield','Ulster Schools’ Plate','Medallion Shield','Medallion Plate','Medallion Bowl','Subsidiary Cup','Ulster Schools’ Girls’ Cup','Friendly'];
const TEAMS = ['1XV','2XV','3XV','U16','Meds','U14','U13','U12','SG','JG'];
const ymd = d => new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0, 10);
const nextSat = () => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); return ymd(d); };
/* the squad for one of our teams, from the player profiles in the main app (team tab = 1XV, Meds, U14 …; Senior rugby covers 1st, 2nd and 3rd XV) */
const SENIOR = ['1XV','2XV','3XV'];
function squadKey(t){ const c = teamCode(t); return c && c !== 'Other' ? c : String(t || '').trim(); }
function squadPlayers(T, team){ const want = squadKey(team), sen = SENIOR.includes(want);
  const isSen = p => /senior/i.test(p.t || '') && !/girl/i.test(p.t || '');
  return (T.roster || []).filter(p => sen && isSen(p) ? (p.xv || '1XV') === want : squadKey(p.t) === want); }
function squadList(T, team){ const ps = squadPlayers(T, team).slice().sort((a, b) => (+a.pos || 99) - (+b.pos || 99) || (a.o || 0) - (b.o || 0));
  const used = new Set(), out = []; ps.forEach(p => { const n = +p.pos; if (n >= 1 && n <= 23 && !used.has(n)){ used.add(n); out.push({n, name:(p.f + ' ' + p.l).trim()}); } else out.push({n:0, name:(p.f + ' ' + p.l).trim()}); });
  let k = 1; out.forEach(p => { if (!p.n){ while (used.has(k)) k++; p.n = k; used.add(k); } }); return out.sort((a, b) => a.n - b.n); }
function squadFor(T, team){ const ps = squadPlayers(T, team); if (!ps.length) return ''; const t = [...new Set(ps.map(p => (p.t || '').trim()))]; return 't:' + (t.find(x => squadKey(x) === squadKey(team)) || team); }
function matchForm(m, past){
  const isNew = !m; let lastPast = null; if (!m && past){ try { lastPast = JSON.parse(localStorage.getItem('ergs.lastPast') || 'null'); } catch(e){} }
  // adding past results one after another: start from the last one entered (team, date, opponent, home/away, competition, venue)
  m = m || (lastPast ? Object.assign({home:'ERGS', away:'', us:'H', team:'1st XV', comp:'', round:'', venue:'', ko:'', code:'union', half:35}, lastPast, {veo:'', players:[], final:['', '']}) : {home:'ERGS', away:'', us:'H', team:'1st XV', comp:'', round:'', venue:'', ko:'', code:'union', half:35, veo:'', players:[]});
  // a new fixture starts on the date of the last one added (if still ahead), otherwise the coming Saturday
  let koD = m.ko ? m.ko.slice(0, 10) : '', koT = m.ko && !m.koTbc ? m.ko.slice(11, 16) : '', koTbc = !!m.koTbc;
  if (isNew && !past){ let last = null; try { last = JSON.parse(localStorage.getItem('ergs.lastNew') || 'null'); } catch(e){}
    const today = ymd(new Date()); koD = last && last.d >= today ? last.d : nextSat(); koT = last && last.t || '11:00'; koTbc = !!(last && last.tbc && last.d >= today); }
  if (!koD && past){ const d = new Date(); koD = ymd(d); koT = koT || '11:00'; }
  if (!koT) koT = '11:00';
  const noPts = !(m.events || []).some(e => ptsOf(e)), showFinal = past || (m.status === 'FT' && noPts), fin = Array.isArray(m.final) ? m.final : ['', ''];
  const opps = [...new Set(Object.values(DATA.schools || {}).map(s => s.name).filter(Boolean).concat(ULSTER))].sort();
  openDialog(`<h2>${isNew ? (past ? 'Add a past result' : 'New match') : 'Match details'}</h2>
    <div class="row2"><div class="field"><label class="label" for="fHome">Home team</label><input class="input" id="fHome" list="oppNames" maxlength="50" value="${esc(m.home)}"></div><div class="field"><label class="label" for="fAway">Away team</label><input class="input" id="fAway" list="oppNames" maxlength="50" value="${esc(m.away)}"></div></div>
    <datalist id="oppNames">${opps.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="row2"><div class="field"><span class="label">ERGS are</span>${seg('us', [['H','Home'],['A','Away']], usOf(m) || 'H')}</div><div class="field"><label class="label" for="fTeam">Our team</label><select class="input" id="fTeam">${teamOptions(m.team)}</select></div></div>
    <div class="row2"><div class="field"><label class="label" for="fComp">Competition</label><input class="input" id="fComp" list="compNames" maxlength="50" value="${esc(m.comp || '')}"><datalist id="compNames">${COMPS.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div><div class="field"><label class="label" for="fRound">Round</label><input class="input" id="fRound" maxlength="30" value="${esc(m.round || '')}" placeholder="Quarter-final"></div></div>
    <div class="row2"><div class="field"><label class="label" for="fVenue">Venue</label><input class="input" id="fVenue" maxlength="60" list="venueNames" value="${esc(isNew && !m.venue ? HOME_GROUND : m.venue || '')}"><datalist id="venueNames">${[HOME_GROUND].concat(opps).map(n => `<option value="${esc(n)}">`).join('')}</datalist></div><div class="field"><label class="label" for="fKo">Date</label><input class="input" id="fKo" type="date" value="${esc(koD)}"><span class="hint ko-day" id="fKoDay"></span></div></div>
    <div class="row2"><div class="field"><label class="label" for="fKoT">Kick-off</label><div class="ko-row"><input class="input" id="fKoT" type="time" value="${esc(koT)}" ${koTbc ? 'disabled' : ''}><label class="ko-tbc"><input type="checkbox" id="fTbc" ${koTbc ? 'checked' : ''}> TBC</label></div></div><div class="field"></div></div>
    <div class="row2"><div class="field"><span class="label">Code</span>${seg('code', [['union','15s'],['sevens','7s']], m.code || 'union')}</div><div class="field"><label class="label" for="fHalf">Half length (min)</label><input class="input" id="fHalf" type="number" min="3" max="45" value="${esc(m.half || 35)}"></div></div>
    ${showFinal ? `<div class="row2"><div class="field"><label class="label" for="fHs">Home score</label><input class="input" id="fHs" type="number" min="0" value="${esc(fin[0])}"></div><div class="field"><label class="label" for="fAs">Away score</label><input class="input" id="fAs" type="number" min="0" value="${esc(fin[1])}"></div></div>
      <div class="row2"><div class="field"><label class="label" for="fHt">Home tries <small>(for cup bonus points)</small></label><input class="input" id="fHt" type="number" min="0" value="${esc((m.finalTries || [])[0] != null ? m.finalTries[0] : '')}"></div><div class="field"><label class="label" for="fAt">Away tries</label><input class="input" id="fAt" type="number" min="0" value="${esc((m.finalTries || [])[1] != null ? m.finalTries[1] : '')}"></div></div>` : ''}
    ${past ? '' : `<div class="field"><label class="label" for="fSheet">Players</label><select class="input" id="fSheet"><option value="">${(m.players || []).length ? 'Current list (' + m.players.length + ' players)' : 'No team sheet'}</option></select><span class="hint" id="fSheetMsg"></span> <button type="button" class="linkish" id="fListBtn">Edit list</button>
      <textarea class="input" id="fPlayers" rows="5" hidden aria-label="Players, one per line with shirt number">${esc((m.players || []).map(p => (p.n ? p.n + ' ' : '') + p.name).join('\n'))}</textarea></div>`}
    <details class="links-x"${veoOf(m) || photosOf(m) ? ' open' : ''}><summary>Video and photos <small>(only signed-in coaches and players see these)</small></summary>
    <div class="field"><label class="label" for="fVeo">VEO link</label><input class="input" id="fVeo" type="url" maxlength="300" value="${esc(veoOf(m))}" placeholder="https://app.veo.co/matches/…"></div>
    <div class="field"><label class="label" for="fPh">Match photos link</label><input class="input" id="fPh" type="url" maxlength="500" value="${esc(photosOf(m))}" placeholder="Google Drive or Google Photos album"><span class="hint">${m.id && PHOTO_AUTO[m.id] && !PHOTOS[m.id] ? 'Found automatically in the photos Drive. Clear it if the photos aren’t from this match.' : ''}</span></div></details>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="fGo">${isNew ? (past ? 'Add result' : 'Create match') : 'Save'}</button></div>`, d => {
    wireSegs(d);
    const tIn = d.querySelector('#fKoT'), tbc = d.querySelector('#fTbc'), dIn = d.querySelector('#fKo'), dayL = d.querySelector('#fKoDay');
    tbc.onchange = () => { tIn.disabled = tbc.checked; };
    const dayTxt = () => { const t = Date.parse(dIn.value + 'T12:00'); dayL.textContent = isNaN(t) ? '' : new Date(t).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'}); };
    dIn.addEventListener('input', dayTxt); dayTxt();
    const sel = d.querySelector('#fSheet'); let picked = false;
    if (sel){ const msg = t => d.querySelector('#fSheetMsg').textContent = t, ta = d.querySelector('#fPlayers');
      d.querySelector('#fListBtn').onclick = () => { ta.hidden = !ta.hidden; if (!ta.hidden) ta.focus(); };
      ta.addEventListener('input', () => { picked = true; sel.value = ''; msg(`${ta.value.split(/\n/).filter(l => l.trim()).length} players typed in`); });
      const apply = (T, v) => { let list = [];
        if (v.startsWith('s:')){ const x = T.sheets.find(y => y.id === v.slice(2)); if (x) list = sheetPlayers(x); }
        if (v.startsWith('t:')) list = squadList(T, v.slice(2));
        if (list.length){ ta.value = list.map(p => p.n + ' ' + p.name).join('\n'); msg(`${list.length} players ready for scoring`); } };
      loadTeams(true).then(T => { if (!T){ msg(''); return; }
        const opts = [];
        [...new Set(T.roster.map(p => (p.t || '').trim()).filter(Boolean))].sort().forEach(t => opts.push(['t:' + t, 'Squad: ' + t]));
        T.sheets.forEach(x => opts.push(['s:' + x.id, 'Team sheet: ' + sheetLabel(x)]));
        sel.insertAdjacentHTML('beforeend', opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join(''));
        // pick the sheet for this fixture automatically (same opponent and day, else same opponent and team)
        const auto = () => { if (picked) return; const us = d.querySelector('[data-seg="us"]').dataset.val;
          const probe = {home:d.querySelector('#fHome').value, away:d.querySelector('#fAway').value, us, team:d.querySelector('#fTeam').value, ko:d.querySelector('#fKo').value + 'T' + (d.querySelector('#fKoT').value || '12:00')};
          const x = m.sheetId && T.sheets.find(y => y.id === m.sheetId) || sheetFor(probe), sq = squadFor(T, probe.team);
          if (x){ sel.value = 's:' + x.id; apply(T, sel.value); }
          else if (sq){ sel.value = sq; apply(T, sq); msg(`${ta.value.split(/\n/).filter(Boolean).length} players from the ${TEAM_NAMES[teamCode(probe.team)] || probe.team} squad`); } else if (!(m.players || []).length){ sel.value = ''; ta.value = ''; msg(T.sheets.length ? 'No sheet for this fixture yet. Pick one if it’s listed.' : 'Add team sheets in the main app under Squads & team sheets.'); } };
        auto();
        ['#fHome', '#fAway', '#fKo', '#fTeam'].forEach(q => d.querySelector(q).addEventListener('change', auto));
        d.querySelector('[data-seg="us"]').addEventListener('change', () => setTimeout(auto, 0));
        sel.onchange = () => { picked = true; if (!sel.value){ return; } apply(T, sel.value);
          if (sel.value.startsWith('s:')){ const x = T.sheets.find(y => y.id === sel.value.slice(2)); if (x){ const us = d.querySelector('[data-seg="us"]').dataset.val, oppIn = us === 'A' ? d.querySelector('#fHome') : d.querySelector('#fAway');
            if (x.opp && !oppIn.value.trim()) oppIn.value = x.opp; if (x.team){ const tc = teamCode(x.team); if (TEAM_CODES.includes(tc)) d.querySelector('#fTeam').value = tc; } } } };
      }); }
    const halfIn = d.querySelector('#fHalf'); d.querySelector('[data-seg="code"]').addEventListener('change', e => { const v = e.target.dataset.val; if (+halfIn.value === 35 || +halfIn.value === 7) halfIn.value = v === 'sevens' ? 7 : 35; });
    // venue follows home/away until someone types their own: our pitches at home, the opponent's school away
    const venueIn = d.querySelector('#fVenue'); let venueAuto = isNew || !m.venue || m.venue === HOME_GROUND;
    venueIn.addEventListener('input', () => { venueAuto = false; });
    const autoVenue = () => { if (!venueAuto) return; const us = d.querySelector('[data-seg="us"]').dataset.val, opp = (us === 'A' ? d.querySelector('#fHome') : d.querySelector('#fAway')).value.trim();
      venueIn.value = us === 'A' ? (OUR_RX.test(opp) ? '' : opp) : HOME_GROUND; };
    d.querySelector('[data-seg="us"]').addEventListener('change', () => setTimeout(autoVenue, 0));
    ['#fHome', '#fAway'].forEach(q => d.querySelector(q).addEventListener('input', autoVenue));
    d.querySelector('[data-seg="us"]').addEventListener('change', () => { const h = d.querySelector('#fHome'), a = d.querySelector('#fAway'), v = d.querySelector('[data-seg="us"]').dataset.val; if ((v === 'A' && OUR_RX.test(h.value)) || (v === 'H' && OUR_RX.test(a.value))){ const t = h.value; h.value = a.value; a.value = t; } });
    d.querySelector('#fGo').onclick = () => {
      const g = id => d.querySelector(id) ? d.querySelector(id).value.trim() : '';
      const f = {home:g('#fHome'), away:g('#fAway'), us:d.querySelector('[data-seg="us"]').dataset.val, team:g('#fTeam'), comp:g('#fComp'), round:g('#fRound'), venue:g('#fVenue'), ko:g('#fKo') ? g('#fKo') + 'T' + (tbc.checked ? '12:00' : g('#fKoT') || '12:00') : '', koTbc:!!(g('#fKo') && tbc.checked), code:d.querySelector('[data-seg="code"]').dataset.val, half:Math.max(3, Math.min(45, +g('#fHalf') || 35)), veo:g('#fVeo')};
      if (!f.home || !f.away){ toast('Enter both team names.'); return; }
      f.home = canonSchool(f.home); f.away = canonSchool(f.away);
      if (f.veo && !/^https:\/\//i.test(f.veo)){ toast('The VEO link must start with https://'); return; }
      const phv = g('#fPh'); if (phv && !/^https:\/\//i.test(phv)){ toast('The photos link must start with https://'); return; }
      const veo = f.veo; delete f.veo;
      if (sel) f.sheetId = sel.value.startsWith('s:') ? sel.value.slice(2) : '';
      if (d.querySelector('#fPlayers')) f.players = g('#fPlayers').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map((l, i) => { const mm2 = l.match(/^(\d{1,2})[.)]?\s+(.+)$/); return mm2 ? {n:+mm2[1], name:mm2[2].replace(/\s*\([^)]*\)\s*$/, '').trim()} : {n:i + 1, name:l.replace(/\s*\([^)]*\)\s*$/, '').trim()}; });
      if (d.querySelector('#fHs')){ if (g('#fHs') === '' || g('#fAs') === ''){ toast('Enter both scores.'); return; } f.final = [+g('#fHs'), +g('#fAs')]; if (g('#fHt') !== '' || g('#fAt') !== '') f.finalTries = [+g('#fHt') || 0, +g('#fAt') || 0]; }
      if (isNew && !past){ try { localStorage.setItem('ergs.lastNew', JSON.stringify({d:g('#fKo'), t:g('#fKoT'), tbc:tbc.checked})); } catch(e){} }
      closeDialog();
      const keepVeo = id => { if (veo !== (VEO[id] || '')) FB.setVeo(id, veo).catch(() => toast('The VEO link didn’t save. Try again.'));
        const was = photosOf(Object.assign({}, m, {id})); if (phv !== was) (phv || !PHOTO_AUTO[id] ? FB.setPhotos(id, phv) : FB.setPhotos(id, PHOTO_NONE)).catch(() => toast('The photos link didn’t save. Try again.')); };

      if (isNew && past){ try { localStorage.setItem('ergs.lastPast', JSON.stringify({home:f.home, away:f.away, us:f.us, team:f.team, comp:f.comp, round:f.round, venue:f.venue, ko:f.ko, koTbc:f.koTbc, code:f.code, half:f.half})); } catch(e){} }
      if (isNew){ const id = uid(); save(dd => dd.matches.push(Object.assign({id, status:past ? 'FT' : 'pre', clock:{base:0, since:0, running:false}, events:[], created:Date.now()}, f)), past ? null : id).then(() => keepVeo(id)); }
      else save(dd => { const x = dd.matches.find(y => y.id === m.id); Object.assign(x, f); delete x.veo; }, m.id).then(() => keepVeo(m.id));
    };
  });
}
/* coach actions */
function act(a, m){
  const now = Date.now(), el = () => elapsed(m), upd = fn => save(d => fn(d.matches.find(y => y.id === m.id)), m.id);
  switch (a){
    case 'cleardemo': return ask('Start real scoring?', 'This removes all the example matches for everyone. You can then add your fixtures.', 'Clear the examples', () => save(d => { d.demo = false; d.matches = []; d.schools = {}; }, null));
    case 'new': return matchForm(null);
    case 'signout': return FB.signOut().then(() => { COACH = false; ADMIN = false; PLAYER = false; VEO = {}; PHOTOS = {}; render(); toast('Signed out.'); });
    case 'coaches': return coachesDialog();
    case 'seed': return fetch('seed.json', {cache:'no-store'}).then(r => r.ok ? r.json() : {matches:[], schools:{}}).catch(() => ({matches:[], schools:{}})).then(seed => save(d => { d.matches = seed.matches || []; d.schools = seed.schools || {}; d.demo = false; }, null));
    case 'past': return matchForm(null, true);
    case 'import': return importDialog();
    case 'schools': return schoolsDialog();
    case 'edit': return matchForm(m);
    case 'postpone': return offDialog(m);
    case 'offedit': return offDialog(m);
    case 'reinstate': return ask('Match back on?', 'The postponed or cancelled notice comes off for everyone.', 'Back on', () => upd(x => { delete x.off; delete x.offWhy; delete x.offAt; }));
    case 'ko': if (m.off){ toast('This match is marked ' + m.off + '. Press Match back on first.'); return; } return upd(x => { x.status = '1H'; x.clock = {base:0, since:now, running:true}; });
    case 'ht': return upd(x => { x.status = 'HT'; x.clock = {base:el(), since:0, running:false}; });
    case '2h': return upd(x => { x.status = '2H'; x.clock = {base:Math.max(el(), (+x.half || 35)*60), since:now, running:true}; });
    case 'ft': return ask('Blow full time?', 'The clock stops and the match moves to Results for everyone.', 'Full time', () => upd(x => { x.status = 'FT'; x.ftAt = Date.now(); x.clock = {base:el(), since:0, running:false}; }).then(() => { let n = 0; const go = () => { const x = DATA.matches.find(y => y.id === m.id); if (x && x.status === 'FT'){ if (usOf(x) && !nomsOf(x).length && $('#modal').hidden) nomsDialog(x); } else if (n++ < 30) setTimeout(go, 100); }; go(); }));
    case 'noms': return nomsDialog(m);
    case 'pause': return upd(x => { const r = x.clock && x.clock.running; x.clock = r ? {base:el(), since:0, running:false} : {base:el(), since:now, running:true}; });
    case 'minus': return upd(x => { x.clock = {base:Math.max(0, el() - 60), since:now, running:!!(x.clock && x.clock.running)}; });
    case 'plus': return upd(x => { x.clock = {base:el() + 60, since:now, running:!!(x.clock && x.clock.running)}; });
    case 'reopen': return upd(x => { x.status = '2H'; x.clock = Object.assign({}, x.clock, {running:false}); });
    case 'del': return ask('Delete this match?', `${m.home} v ${m.away} and its timeline will be removed for everyone.`, 'Delete', () => save(d => { d.matches = d.matches.filter(y => y.id !== m.id); }, null));
    case 'share': { const link = location.origin + location.pathname + '#m.' + m.id; copy(link, 'Match link copied. Anyone can open it.'); return; }
    case 'copyres': { const [h, aa] = score(m), sc = s => ['try','pt','con','pen','dg'].map(k => { const l = sorted(m).filter(e => e.s === s && e.k === k && !e.miss); if (!l.length) return ''; const names = l.map(e => e.p ? e.p.split(/\s+/).pop() : '').filter(Boolean); return ({try:'Try',pt:'Pen try',con:'Con',pen:'Pen',dg:'DG'})[k] + (names.length ? ': ' + names.join(', ') : ' ' + l.length); }).filter(Boolean).join('\n');
      copy(`${m.home} ${h} – ${aa} ${m.away}\n${compLine(m)}\n\n${m.home}\n${sc('H')}\n\n${m.away}\n${sc('A')}`.trim(), 'Result copied. Paste it into the full-time graphic in the main app.'); return; }
  }
}
function copy(text, ok){ try { navigator.clipboard.writeText(text).then(() => toast(ok), () => showCopy(text)); } catch(e){ showCopy(text); } }
function showCopy(text){ openDialog(`<h2>Copy this</h2><textarea class="input" rows="6" readonly id="copyBox">${esc(text)}</textarea><div class="dlg-a"><button type="button" class="btn primary" data-close>Done</button></div>`, d => { const t = d.querySelector('#copyBox'); t.focus(); t.select(); }); }

/* ---------- school crests ---------- */
function fileToImage(file){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img')); im.src = r.result; }; r.onerror = rej; r.readAsDataURL(file); }); }
function shrink(im, max){ const k = Math.min(1, max/Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth*k)); c.height = Math.max(1, Math.round(im.naturalHeight*k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c; }
function mainColour(c){ const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, B = new Map(); for (let i = 0; i < x.length; i += 16){ if (x[i+3] < 170) continue; const r = x[i], g = x[i+1], b = x[i+2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx > 235 && mn > 220) continue; const k = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5), w = 1 + (mx - mn)/60, o = B.get(k) || {w:0, r:0, g:0, b:0, n:0}; o.w += w; o.r += r; o.g += g; o.b += b; o.n++; B.set(k, o); } const best = [...B.values()].sort((a, b) => b.w - a.w)[0]; if (!best) return '#3A4466'; return '#' + [best.r, best.g, best.b].map(v => Math.round(v/best.n).toString(16).padStart(2, '0')).join(''); }
function schoolsDialog(){
  const names = new Set(); DATA.matches.forEach(m => [m.home, m.away].forEach(n => { if (n && !OUR_RX.test(n)) names.add(canonSchool(n)); }));
  Object.values(DATA.schools || {}).forEach(s => s.name && names.add(canonSchool(s.name)));
  const gone = new Set((DATA.removedSchools || []).map(canonSchool));
  ULSTER.forEach(n => { const c = canonSchool(n); if (!gone.has(c)) names.add(c); });   // every Ulster school (except ones you removed), so missing crests are easy to spot
  const list = [...names].sort();
  const opps = [...new Set(Object.values(DATA.schools || {}).map(s => s.name).filter(Boolean).concat(ULSTER))].filter(n => !gone.has(canonSchool(n))).sort();
  openDialog(`<h2>School crests</h2><p>Add each school’s crest once and it shows on every match against them. Small images keep the page quick for supporters.</p>
    <form class="sch-add" id="schAdd"><div class="field"><label class="label" for="schName">Add a school</label><input class="input" id="schName" list="schAddNames" maxlength="50" placeholder="School name" autocomplete="off"><datalist id="schAddNames">${opps.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
      <label class="btn" id="schPick">Choose crest<input type="file" accept="image/*" hidden id="schFile"></label><button type="submit" class="btn primary">Add</button></form>
    ${schListHTML(list)}
    <div class="dlg-a"><button type="button" class="btn primary" data-close>Done</button></div>`, d => {
    let addFile = null; const fileIn = d.querySelector('#schFile'), pick = d.querySelector('#schPick');
    fileIn.onchange = () => { addFile = fileIn.files[0] || null; pick.firstChild.textContent = addFile ? 'Crest chosen ✓' : 'Choose crest'; };
    d.querySelector('#schAdd').onsubmit = async ev => { ev.preventDefault(); const raw = d.querySelector('#schName').value.trim(); if (!raw){ toast('Type the school’s name.'); return; }
      const n = canonSchool(raw); let crestUrl = '', col = '';
      if (addFile){ try { const im = await fileToImage(addFile), c = shrink(im, 96); crestUrl = c.toDataURL('image/webp', 0.85); col = mainColour(c); } catch(e){ toast('That image could not be opened.'); return; } }
      await save(dd => { dd.schools = dd.schools || {}; const k = schoolKey(n); dd.schools[k] = Object.assign({name:n}, dd.schools[k], crestUrl ? {crest:crestUrl, color:(dd.schools[k] || {}).color || col} : {}); if (dd.removedSchools) dd.removedSchools = dd.removedSchools.filter(x => !sameSchool(x, n)); });
      toast(crestUrl ? `${n} added with its crest.` : `${n} added. Press Crest beside it to upload one.`);
      for (let i = 0; i < 20 && !Object.values(DATA.schools || {}).some(x => x && canonSchool(x.name || '') === n); i++) await new Promise(r => setTimeout(r, 100));
      schoolsDialog(); };
    d.querySelectorAll('[data-crest]').forEach(inp => inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const n = inp.dataset.crest;
      try { const im = await fileToImage(f), c = shrink(im, 96), url = c.toDataURL('image/webp', 0.85), col = mainColour(c); closeDialog(); save(dd => { dd.schools = dd.schools || {}; const k = schoolKey(n); dd.schools[k] = Object.assign({}, dd.schools[k], {name:n, crest:url, color:(dd.schools[k] || {}).color || col}); }); }
      catch(e){ toast('That image could not be opened.'); } });
    d.querySelectorAll('[data-delcrest]').forEach(b => b.onclick = () => { const n = b.dataset.delcrest;
      ask(`Delete ${n}’s crest?`, 'Their matches will show initials instead. You can add a crest again any time.', 'Delete', () => save(dd => { const c = canonSchool(n);
        Object.keys(dd.schools || {}).forEach(k => { const v = dd.schools[k]; if (k === schoolKey(n) || (v && v.name && canonSchool(v.name) === c)) delete dd.schools[k]; }); }).then(() => { toast(`${n}’s crest deleted.`); schoolsDialog(); })); });
    d.querySelectorAll('[data-col]').forEach(inp => inp.onchange = () => { const n = inp.dataset.col; closeDialog(); save(dd => { dd.schools = dd.schools || {}; const k = schoolKey(n); dd.schools[k] = Object.assign({name:n}, dd.schools[k], {color:inp.value}); }); });
    d.querySelectorAll('[data-schf]').forEach(b => b.onclick = () => { V.schFilter = b.dataset.schf; schoolsDialog(); });
    d.querySelectorAll('[data-merge]').forEach(b => b.onclick = () => schMergeDialog(b.dataset.merge, list));
    d.querySelectorAll('[data-delsch]').forEach(b => b.onclick = () => schDeleteDialog(b.dataset.delsch));
    d.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => { const n = b.dataset.restore; await save(dd => { dd.removedSchools = (dd.removedSchools || []).filter(x => x !== n); }); toast(`${n} restored.`); schReopen(() => !(DATA.removedSchools || []).includes(n)); });
  });
}

/* ---------- import fixtures ---------- */
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function seasonYear(mon){ const now = new Date(), start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1; return mon >= 7 ? start : start + 1; }
function parseDate(s){
  s = String(s || '').trim().toLowerCase(); if (!s) return '';
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/); if (m){ const mo = +m[2] - 1; let y = m[3] ? +m[3] : seasonYear(mo); if (y < 100) y += 2000; if (mo >= 0 && mo < 12) return `${y}-${String(mo + 1).padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,})\.?(?:\s+(\d{4}))?/); if (m){ const mo = MONTHS.indexOf(m[2].slice(0,3)); if (mo >= 0){ const y = m[3] ? +m[3] : seasonYear(mo); return `${y}-${String(mo + 1).padStart(2,'0')}-${m[1].padStart(2,'0')}`; } }
  m = s.match(/([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/); if (m){ const mo = MONTHS.indexOf(m[1].slice(0,3)); if (mo >= 0){ const y = m[3] ? +m[3] : seasonYear(mo); return `${y}-${String(mo + 1).padStart(2,'0')}-${m[2].padStart(2,'0')}`; } }
  return '';
}
function parseTime(s){ s = String(s || '').toLowerCase(); let m = s.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?/); if (m){ let h = +m[1]; if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0; if (h < 24) return `${String(h).padStart(2,'0')}:${m[2]}`; }
  m = s.match(/\b(\d{1,2})\s*(am|pm)\b/); if (m){ let h = +m[1]; if (m[2] === 'pm' && h < 12) h += 12; return `${String(h).padStart(2,'0')}:00`; } return ''; }
const haOf = s => { s = String(s || '').trim().toLowerCase(); return /^(h|home)$/.test(s) ? 'H' : /^(a|away)$/.test(s) ? 'A' : ''; };
function parseFixtureText(text){
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean); if (!lines.length) return [];
  const delim = lines.some(l => l.includes('|')) ? '|' : lines.some(l => l.includes('\t')) ? '\t' : lines.filter(l => l.includes(',')).length >= lines.length*0.6 ? ',' : null;
  const split = l => l.split(delim).map(x => x.trim().replace(/^"|"$/g, ''));
  const out = [];
  if (delim){
    let idx = null; const head = split(lines[0]).map(h => h.toLowerCase());
    if (head.some(h => /date/.test(h)) && head.some(h => /opp|vs|versus|against|^v$|team|fixture/.test(h))){
      const find = rx => head.findIndex(h => rx.test(h));
      idx = {date:find(/date|day/), time:find(/time|ko|kick/), team:find(/^team|squad|age|^xv/), opp:find(/opp|vs|versus|against|^v$|fixture/), ha:find(/h\/a|home|^ha$|^venue type/), venue:find(/venue|ground|location|where/), comp:find(/comp|cup|league|type/)};
      lines.shift();
    }
    for (const l of lines){ const c = split(l); let f;
      if (idx) f = {date:parseDate(c[idx.date]), time:parseTime(idx.time >= 0 ? c[idx.time] : c[idx.date]), team:idx.team >= 0 ? c[idx.team] : '', opp:idx.opp >= 0 ? c[idx.opp] : '', ha:idx.ha >= 0 ? haOf(c[idx.ha]) : '', venue:idx.venue >= 0 ? c[idx.venue] : '', comp:idx.comp >= 0 ? c[idx.comp] : ''};
      else f = {date:parseDate(c[0]), team:c[1] || '', opp:c[2] || '', ha:haOf(c[3]), time:parseTime(c[4] || c[0]), comp:c[5] || '', venue:c[6] || ''};
      f.opp = (f.opp || '').replace(/^(v|vs)\.?\s+/i, '').trim();
      if (f.date && f.opp) out.push(f); }
  } else {
    for (const l of lines){ const date = parseDate(l), vs = l.match(/\b(?:v|vs|versus)\.?\s+(.+?)(?:\s*\((h|a|home|away)\)|\s+(?:home|away)\b|\s+\d{1,2}[:.]\d{2}|$)/i);
      if (!date || !vs) continue; const ha = (l.match(/\((h|a|home|away)\)/i) || l.match(/\b(home|away)\b/i) || [])[1];
      const before = l.slice(0, l.toLowerCase().indexOf(vs[0].toLowerCase())).replace(/^.*?\d{4}|^.*?\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,}\.?/i, '').trim();
      out.push({date, time:parseTime(l), team:before.replace(/^[,\-–:]+|[,\-–:]+$/g, '').trim(), opp:vs[1].trim(), ha:haOf(ha), venue:'', comp:''}); }
  }
  return out;
}
/* =============================== READING TEAM SHEETS (photos and PDFs) =============================== */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('script')); document.head.appendChild(s); }); }
let pdfReady = null;
function pdfLib(){
  if (!pdfReady){ pdfReady = (async () => { await loadScript(PDFJS + 'pdf.min.js'); await loadScript(PDFJS + 'pdf.worker.min.js'); const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; return lib; })(); pdfReady.catch(() => { pdfReady = null; }); }
  return pdfReady;
}
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
async function fileToImages(file, lim, maxPages){
  const types = lim.mediaTypes || [];
  if (isPdf(file)){
    if (types.includes('application/pdf') && file.size <= lim.maxInputBytes) return [file];
    const lib = await pdfLib(), doc = await lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise, out = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++){
      const pg = await doc.getPage(i), v0 = pg.getViewport({scale:1}), vp = pg.getViewport({scale:Math.min(2.5, 1800/Math.max(v0.width, v0.height))});
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await pg.render({canvasContext:x, viewport:vp}).promise; out.push(await canvasBlob(c, 'image/jpeg', 0.86));
    }
    return out;
  }
  if (types.includes(file.type) && file.size <= lim.maxInputBytes) return [file];
  return [await canvasBlob(imageToCanvas(await fileToImage(file), 1800), 'image/jpeg', 0.88)];
}
function canvasBlob(c, type, q){ return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('blob')), type, q)); }
function imageToCanvas(im, max){ return shrink(im, max); }
function importDialog(){
  openDialog(`<h2>Import fixtures</h2><p>Paste the fixtures list or upload a CSV${SAMPLE ? ', photo or PDF' : ''}. One line per fixture works best, e.g. <b>Sat 7 Feb 2026 | 1st XV | Banbridge Academy | H | 10:30 | Schools’ Bowl</b>.</p>
    <div class="ctrl"><label class="btn">Upload ${SAMPLE ? 'photo, PDF or CSV' : 'CSV'}<input type="file" id="impFile" accept="${SAMPLE ? 'image/*,application/pdf,' : ''}.csv,.txt,text/csv,text/plain" multiple hidden></label></div>
    <textarea class="input" id="impText" rows="5" aria-label="Fixtures list"></textarea>
    <div class="ctrl"><button type="button" class="btn" id="impRead">Read the list</button><span class="hint" id="impMsg" aria-live="polite"></span></div>
    <div id="impPrev"></div>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="impAdd" disabled>Add fixtures</button></div>`, d => {
    let rows = [];
    const msg = t => d.querySelector('#impMsg').textContent = t;
    const show = list => { rows = list.map(r => Object.assign({on:!exists(r)}, r)); d.querySelector('#impPrev').innerHTML = rows.length ? `<div class="tbl"><table><thead><tr><th></th><th>Date</th><th>KO</th><th>Team</th><th>Opponent</th><th>H/A</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" ${r.on ? 'checked' : ''} aria-label="Include"></td><td>${esc(new Date(r.date + 'T12:00').toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}))}</td><td>${esc(r.time || 'TBC')}</td><td>${esc(r.team || '–')}</td><td>${esc(r.opp)}${exists(r) ? ' <small>(already added)</small>' : ''}</td><td>${esc(r.ha || '–')}</td></tr>`).join('')}</tbody></table></div>` : '';
      d.querySelectorAll('[data-i]').forEach(c => c.onchange = () => { rows[+c.dataset.i].on = c.checked; count(); }); count(); };
    const count = () => { const n = rows.filter(r => r.on).length; const b = d.querySelector('#impAdd'); b.disabled = !n; b.textContent = `Add ${n} ${n === 1 ? 'fixture' : 'fixtures'}`; };
    d.querySelector('#impRead').onclick = async () => { const t = d.querySelector('#impText').value.trim(); if (!t){ msg('Paste the list first.'); return; }
      let r = parseFixtureText(t); if (r.length){ msg(`Found ${r.length} fixtures. Untick any you don’t want.`); show(r); return; }
      if (!SAMPLE){ msg('That list couldn’t be read. Use one line per fixture: date | team | opponent | H or A | time.'); return; }
      try { r = await readWithClaude(t, null, msg); msg(r.length ? `Found ${r.length} fixtures.` : 'No fixtures were found.'); show(r); } catch(e){ msg(sampleErr(e)); } };
    d.querySelector('#impFile').onchange = async e => { const files = [...e.target.files]; e.target.value = ''; let r = [];
      const texts = files.filter(f => /\.(csv|txt)$/i.test(f.name) || /^text\//.test(f.type)), pics = files.filter(f => !texts.includes(f));
      for (const f of texts){ const t = await f.text(); const got = parseFixtureText(t); if (got.length) r = r.concat(got); else d.querySelector('#impText').value += t; }
      if (pics.length && SAMPLE){ try { r = r.concat(await readWithClaude('', pics, msg)); } catch(err){ msg(sampleErr(err)); } }
      if (r.length){ msg(`Found ${r.length} fixtures. Untick any you don’t want.`); show(r); } };
    d.querySelector('#impAdd').onclick = () => { const pick = rows.filter(r => r.on); if (!pick.length) return; closeDialog();
      save(dd => pick.forEach((r, i) => { const us = r.ha || 'H', sev = /7s|vii|sevens/i.test(r.team + ' ' + r.comp);
        dd.matches.push({id:uid(), home:us === 'H' ? 'ERGS' : r.opp, away:us === 'H' ? r.opp : 'ERGS', us, team:r.team, comp:r.comp, round:'', venue:r.venue || (us === 'H' ? HOME_GROUND : r.opp), ko:r.date + 'T' + (r.time || '12:00'), koTbc:!r.time, code:sev ? 'sevens' : 'union', half:sev ? 7 : 35, veo:'', status:'pre', clock:{base:0, since:0, running:false}, events:[], created:Date.now() + i}); }), null); };
  });
}
function exists(r){ return DATA.matches.some(m => { const opp = usOf(m) === 'A' ? m.home : m.away; return (m.ko || '').slice(0, 10) === r.date && schoolKey(opp) === schoolKey(r.opp); }); }
let SAMPLE = null;
function sampleErr(e){ const c = e && e.code; return c === 'not_granted' ? 'Reading photos needs your permission. Allow it when asked, or paste the list.' : c === 'rate_limited' ? 'Too many requests just now. Wait a minute and try again.' : 'That couldn’t be read. Try again, or paste the list.'; }
async function readWithClaude(text, files, onMsg){
  const lim = (await SAMPLE.limits()).images; let imgs = [];
  if (files && files.length){ if (!lim) throw {code:'images_unavailable'}; for (const f of files){ onMsg(`Preparing ${f.name}…`); try { imgs = imgs.concat(await fileToImages(f, lim, 6)); } catch(e){ onMsg(`${f.name} could not be opened.`); } } imgs = imgs.slice(0, lim.maxCount || 5); }
  onMsg('Reading the fixtures… this can take up to a minute.');
  const today = new Date().toISOString().slice(0, 10);
  const r = await SAMPLE.json(`Extract every rugby fixture for Enniskillen Royal Grammar School (ERGS) from ${imgs.length ? 'these images' : 'this text'}. Today is ${today}; the season runs August to June, so infer missing years from that.
For each fixture give: date (YYYY-MM-DD), kick-off time (HH:MM 24-hour, or ""), our team ("1st XV", "U14", "Medallion XV", "Girls 7s"…, or ""), the opponent's name, homeAway ("H", "A" or ""), venue ("" if not given) and competition (or "").
Leave out byes, training and anything that is not a match. Reply with only JSON: {"fixtures":[{"date":"2026-02-07","time":"10:30","team":"1st XV","opponent":"Banbridge Academy","homeAway":"H","venue":"","competition":"Ulster Schools' Bowl"}]}${text ? '\n\nThe list:\n' + text.slice(0, 20000) : ''}`, imgs.length ? {images:imgs} : {});
  return (r && Array.isArray(r.fixtures) ? r.fixtures : []).map(f => ({date:/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : parseDate(f.date), time:/^\d{2}:\d{2}$/.test(f.time || '') ? f.time : parseTime(f.time), team:String(f.team || ''), opp:String(f.opponent || ''), ha:haOf(f.homeAway), venue:String(f.venue || ''), comp:String(f.competition || '')})).filter(f => f.date && f.opp);
}

/* ---------- score animation for supporters ---------- */
const fx = $('#fx'), Q = []; let busy = false;
/* headshots in the score animations: a small public copy of the player's profile photo, made when a coach records the score */
const FACES = {};
const faceKey = n => String(n || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^#?\d{1,2}\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
function loadFace(k){ if (FACES[k] !== undefined) return Promise.resolve(FACES[k]); if (!k || !window.FB || !FB.face){ FACES[k] = ''; return Promise.resolve(''); }
  return Promise.race([FB.face(k), new Promise(r => setTimeout(() => r(null), 1500))]).then(d => { if (d !== null) FACES[k] = d || ''; else FACES[k] = ''; return FACES[k]; }); }
async function publishFace(name){
  const k = faceKey(name); if (!COACH || !k || FACES[k]) return;
  try {
    const T = await loadTeams(); const want = k; const p = ((T && T.roster) || []).find(x => faceKey((x.f || '') + ' ' + (x.l || '')) === want);
    if (!p || !p.photo || !/^fsimg:/.test(p.photo)) return;
    const src = await FB.image(p.photo.slice(6)); if (!src) return;
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const S2 = 220, c = document.createElement('canvas'); c.width = c.height = S2; const g = c.getContext('2d'), w = im.naturalWidth, h = im.naturalHeight, s0 = Math.min(w, h);
    g.drawImage(im, (w - s0)/2, h > w ? (h - s0)*0.18 : 0, s0, s0, 0, 0, S2, S2);
    const d = c.toDataURL('image/jpeg', 0.82); FACES[k] = d; await FB.setFace(k, d);
  } catch(e){}
}
function playFx(){
  const nx = Q.shift(); if (!nx){ busy = false; return; } busy = true;
  const [m, e] = nx, team = e.s === 'H' ? m.home : m.away, [h, a] = score(m);
  if (e.k === 'ft'){ $('#fxFace').hidden = true; return playFullTime(m); }
  const fk = e.p && e.s === usOf(m) && ptsOf(e) > 0 ? faceKey(e.p) : '';
  if (fk && FACES[fk] === undefined){ loadFace(fk).then(() => { Q.unshift(nx); playFx(); }); return; }
  const ff = $('#fxFace'); ff.hidden = !(fk && FACES[fk]); ff.innerHTML = fk && FACES[fk] ? `<img alt="" src="${FACES[fk]}">` : '';
  const isKick = e.k === 'con' || e.k === 'pen' || e.k === 'dg', missed = !!(isKick && e.miss);
  const lab = missed ? (e.k === 'con' ? 'CONVERSION MISSED' : e.k === 'pen' ? 'PENALTY MISSED' : 'DROP GOAL MISSED') : e.k === 'try' ? 'TRY!' : e.k === 'pt' ? 'PENALTY TRY' : e.k === 'con' ? 'CONVERTED' : e.k === 'pen' ? 'PENALTY GOAL' : e.k === 'dg' ? 'DROP GOAL' : e.k === 'yc' ? 'YELLOW CARD' : 'RED CARD';
  fx.className = 'fx k-' + e.k; fx.style.setProperty('--tc', e.k === 'yc' ? '#F3C443' : e.k === 'rc' ? '#E5483B' : ((school(team) || {}).color || '#3A4466'));
  const kickIn = isKick, card = e.k === 'yc' || e.k === 'rc';
  fx.classList.toggle('miss', missed);
  const tryIn = e.k === 'try' || e.k === 'pt';
  fx.classList.toggle('kick', kickIn); fx.classList.toggle('cardfx', card); fx.classList.toggle('tryfx', tryIn);
  $('#fxCrest').innerHTML = card ? `<div class="fx-cardwrap"><div class="fx-rings"><i></i><i></i><i></i></div><div class="fx-card ${e.k}"><span></span></div></div>`
    : kickIn ? `<div class="fx-posts"><svg viewBox="0 0 200 230" aria-hidden="true"><rect class="up" x="56" y="6" width="7" height="224" rx="3"/><rect class="up" x="137" y="6" width="7" height="224" rx="3"/><rect class="bar" x="56" y="132" width="88" height="7" rx="3"/><rect class="pad" x="52" y="170" width="15" height="60" rx="3"/><rect class="pad" x="133" y="170" width="15" height="60" rx="3"/></svg>
        <div class="fx-ball"><svg viewBox="0 0 60 40" aria-hidden="true"><ellipse cx="30" cy="20" rx="28" ry="17" fill="#F6EFDF" stroke="#5a3a1a" stroke-width="2"/><path d="M8 20h44" stroke="#C8102E" stroke-width="3"/><path d="M26 14v12M30 13v14M34 14v12" stroke="#5a3a1a" stroke-width="1.6"/></svg></div><div class="fx-crestmini">${crest(team)}</div></div>`
    : tryIn ? `<div class="fx-try"><div class="fx-turf"><b></b><i></i></div><div class="fx-impact"><i></i><i></i></div>
        <div class="fx-spray">${Array.from({length:16}, (_, i) => { const a = Math.PI*(1.05 + Math.random()*.9), d = 50 + Math.random()*90; return `<i style="--x:${Math.round(Math.cos(a)*d)}px;--y:${Math.round(Math.sin(a)*d*0.8)}px;--d:${(Math.random()*.12).toFixed(2)}s"></i>`; }).join('')}</div>
        <div class="fx-tball"><svg viewBox="0 0 60 40" aria-hidden="true"><ellipse cx="30" cy="20" rx="28" ry="17" fill="#F6EFDF" stroke="#5a3a1a" stroke-width="2"/><path d="M8 20h44" stroke="#C8102E" stroke-width="3"/><path d="M26 14v12M30 13v14M34 14v12" stroke="#5a3a1a" stroke-width="1.6"/></svg></div>
        <div class="fx-plus">+${PTS[e.k]}</div><div class="fx-trycrest">${crest(team, 'huge')}</div></div>`
    : crest(team, 'huge');
  let li = 0; $('#fxKind').innerHTML = lab.split(' ').map(w => `<span class="w">${w.split('').map(c => `<span style="--i:${li++}">${esc(c)}</span>`).join('')}</span>`).join('<span style="--i:0">&nbsp;</span>');
  $('#fxWho').textContent = [e.p, team].filter(Boolean).join(' · ');
  $('#fxScore').textContent = ptsOf(e) || missed ? `${m.home} ${h} – ${a} ${m.away}` : e.k === 'yc' ? `Sin bin · ${m.code === 'sevens' ? '2' : '10'} minutes` : e.k === 'rc' ? 'Sent off' : '';
  const burst = $('#fxBurst'); burst.innerHTML = '';
  if (ptsOf(e)) for (let i = 0; i < 28; i++){ const s = document.createElement('i'), ang = Math.random()*Math.PI*2, d = 140 + Math.random()*260; s.style.cssText = `--x:${Math.cos(ang)*d}px;--y:${Math.sin(ang)*d}px;--d:${(Math.random()*.25).toFixed(2)}s;--s:${(.6 + Math.random()*.9).toFixed(2)}`; burst.appendChild(s); }
  // our try: a big confetti explosion in school colours (not when the opposition score)
  let conf = $('#fxConfetti'); if (!conf){ conf = document.createElement('div'); conf.id = 'fxConfetti'; conf.className = 'fx-confetti'; fx.appendChild(conf); }
  conf.innerHTML = '';
  if (tryIn && usOf(m) === e.s){ const cols = ['#DCC08A', '#E3262A', '#FFFFFF', '#1C2342', '#F3D27A'];
    for (let i = 0; i < 90; i++){ const c = document.createElement('i'), ang = -Math.PI/2 + (Math.random() - .5)*Math.PI*1.3, v = 260 + Math.random()*420;
      c.style.cssText = `--x:${Math.round(Math.cos(ang)*v)}px;--y:${Math.round(Math.sin(ang)*v)}px;--f:${Math.round(380 + Math.random()*420)}px;--r:${Math.round(360 + Math.random()*1080)}deg;--d:${(Math.random()*.18).toFixed(2)}s;--c:${cols[i % cols.length]};--w:${(6 + Math.random()*8).toFixed(1)}px;--h:${(10 + Math.random()*12).toFixed(1)}px;--t:${(2 + Math.random()*1.1).toFixed(2)}s`;
      conf.appendChild(c); } }
  fx.hidden = false; void fx.offsetWidth; fx.classList.add('on');
  try { if (navigator.vibrate) navigator.vibrate(card ? [300] : ptsOf(e) ? [120, 60, 120] : 0); } catch(err){}
  const close = () => { fx.classList.remove('on'); fx.classList.add('off'); setTimeout(() => { fx.hidden = true; fx.classList.remove('off'); playFx(); }, 420); };
  clearTimeout(playFx.t); playFx.t = setTimeout(close, kickIn ? 3700 : tryIn ? 3800 : card ? 3400 : ptsOf(e) ? 3000 : 2300); fx.onclick = () => { clearTimeout(playFx.t); close(); };
}
/* full time: a giant celebration when we win, a quiet card when we don't */
function playFullTime(m){
  const r = resultOf(m), [h, a] = score(m), win = r && r.r === 'W', draw = r && r.r === 'D';
  fx.className = 'fx k-ft ' + (win ? 'ftwin' : 'ftquiet'); fx.style.setProperty('--tc', win ? '#1C2342' : '#3A4466');
  $('#fxCrest').innerHTML = win ? `<div class="ft-rays" aria-hidden="true"></div>${crest(OUR_RX.test(m.home) ? m.home : m.away, 'huge')}` : crest(OUR_RX.test(m.home) ? m.home : m.away);
  const lab = 'FULL TIME'; let li = 0;
  $('#fxKind').innerHTML = lab.split(' ').map(w => `<span class="w">${w.split('').map(c => `<span style="--i:${li++}">${esc(c)}</span>`).join('')}</span>`).join('<span style="--i:0">&nbsp;</span>');
  $('#fxWho').textContent = win ? `ERGS win!` : draw ? 'A draw' : `${r ? r.opp : ''} win`;
  $('#fxScore').textContent = `${m.home} ${h} – ${a} ${m.away}`;
  $('#fxBurst').innerHTML = '';
  let conf = $('#fxConfetti'); if (!conf){ conf = document.createElement('div'); conf.id = 'fxConfetti'; conf.className = 'fx-confetti'; fx.appendChild(conf); }
  conf.innerHTML = '';
  if (win){ const cols = ['#DCC08A', '#E3262A', '#FFFFFF', '#1C2342', '#F3D27A'];
    for (let w = 0; w < 3; w++) for (let i = 0; i < 70; i++){ const c = document.createElement('i'), ang = -Math.PI/2 + (Math.random() - .5)*Math.PI*1.5, v = 280 + Math.random()*460;
      c.style.cssText = `--x:${Math.round(Math.cos(ang)*v)}px;--y:${Math.round(Math.sin(ang)*v)}px;--f:${Math.round(420 + Math.random()*460)}px;--r:${Math.round(360 + Math.random()*1080)}deg;--d:${(w*1.1 + Math.random()*.25).toFixed(2)}s;--c:${cols[i % cols.length]};--w:${(6 + Math.random()*9).toFixed(1)}px;--h:${(10 + Math.random()*13).toFixed(1)}px;--t:${(2.2 + Math.random()*1.2).toFixed(2)}s`;
      conf.appendChild(c); } }
  fx.hidden = false; void fx.offsetWidth; fx.classList.add('on');
  try { if (win && navigator.vibrate) navigator.vibrate([150, 80, 150, 80, 300]); } catch(err){}
  const close = () => { fx.classList.remove('on'); fx.classList.add('off'); setTimeout(() => { fx.hidden = true; fx.classList.remove('off'); playFx(); }, 420); };
  clearTimeout(playFx.t); playFx.t = setTimeout(close, win ? 6500 : 4000); fx.onclick = () => { clearTimeout(playFx.t); close(); };
}
function newSinceLastLook(){
  const SK = SANDBOX ? '.demo' : ''; let seen = null; try { seen = JSON.parse(localStorage.getItem('ergsLive.seen' + SK) || 'null'); } catch(e){}
  const now = {};
  for (const m of DATA.matches.filter(isLive)){ now[m.id] = (m.events || []).map(e => e.id);
    if (seen && seen[m.id]) for (const e of sorted(m)) if (!seen[m.id].includes(e.id) && e.k === 'note' && e.p && Date.now() - (e.ts || 0) < 10*60e3) CQ.push([m, e]);
    if (seen && seen[m.id]) for (const e of sorted(m)) if (!seen[m.id].includes(e.id) && e.k !== 'note' && (!e.miss || ['con','pen','dg'].includes(e.k)) && Date.now() - (e.ts || 0) < 15*60e3) Q.push([m, e]); }
  try { localStorage.setItem('ergsLive.seen' + SK, JSON.stringify(now)); } catch(e){}
  // full time: once per match, for matches that finished in the last 15 minutes while someone was following
  let ftSeen = []; try { ftSeen = JSON.parse(localStorage.getItem('ergsLive.ft' + SK) || '[]'); } catch(e){}
  // keyed by when the whistle went, so a reopened match that finishes again celebrates again
  for (const m of DATA.matches) if (m.status === 'FT' && m.ftAt && Date.now() - m.ftAt < 15*60e3 && !ftSeen.includes(m.id + ':' + m.ftAt)){
    ftSeen.push(m.id + ':' + m.ftAt); if (seen && seen[m.id] && usOf(m)) Q.push([m, {id:'ft-' + m.id, k:'ft', s:usOf(m), ts:m.ftAt}]); }
  try { localStorage.setItem('ergsLive.ft' + SK, JSON.stringify(ftSeen.slice(-40))); } catch(e){}
  if (Q.length && !busy){ busy = true; setTimeout(playFx, 500); }
  if (CQ.length && !cbusy) setTimeout(playComm, Q.length ? 4200 : 600);
}
/* commentary arrives like a commentator on air: a lower-third with a mic, typed out word by word */
const CQ = []; let cbusy = false;
function playComm(){
  if (busy){ setTimeout(playComm, 800); return; }
  const nx = CQ.shift(); if (!nx){ cbusy = false; return; } cbusy = true;
  const [m, e] = nx; let el = $('#comm');
  if (!el){ el = document.createElement('div'); el.id = 'comm'; el.className = 'comm'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  const [h, a] = score(m);
  el.innerHTML = `<div class="comm-mic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 18v4M8 22h8" stroke="currentColor" stroke-width="2"/></svg><i></i><i></i></div>
    <div class="comm-body"><div class="comm-h"><b>Live commentary</b><span>${e.m}′ · ${esc(m.home)} ${h}–${a} ${esc(m.away)}</span></div><p class="comm-t"></p></div><button type="button" class="comm-x" aria-label="Close">×</button>`;
  const t = el.querySelector('.comm-t'), words = String(e.p).split(/(\s+)/); let i = 0;
  el.hidden = false; void el.offsetWidth; el.classList.add('on');
  const type = () => { if (i >= words.length){ t.classList.add('done'); return; } t.textContent += words[i++]; el._t = setTimeout(type, /\s/.test(words[i - 1]) ? 0 : 70 + Math.random()*60); };
  setTimeout(type, 450);
  const close = () => { clearTimeout(el._t); clearTimeout(el._c); el.classList.remove('on'); setTimeout(() => { el.hidden = true; playComm(); }, 400); };
  el.querySelector('.comm-x').onclick = close; el.onclick = ev => { if (ev.target === el){ V.open = m.id; render(); close(); } };
  el._c = setTimeout(close, 2600 + String(e.p).length*90);
}
$('#demoTry').onclick = () => {
  const m = DATA.matches.find(isLive); if (!m) return;
  const e = {id:'d' + Date.now(), k:'try', s:'H', p:'Example player', m:minuteNow(m), at:Math.round(elapsed(m)), ts:Date.now()};
  m.events.push(e); V.open = null; V.tab = 'matches'; render(); Q.push([m, e]); if (!busy) playFx();
};

/* ---------- coaches list (admin only) ---------- */
async function coachesDialog(){
  let list = []; try { list = await FB.listCoaches(); } catch(e){ toast('Couldn’t load the coaches list.'); return; }
  openDialog(`<h2>Coaches</h2><p>People who can score. They sign in with this Google account.</p>
    <div class="schs">${[CFG.admin].concat(list.filter(x => x !== CFG.admin)).filter(Boolean).map(e => `<div class="sch" style="grid-template-columns:minmax(0,1fr) auto"><span>${esc(e)}${e === CFG.admin ? ' <small>(admin)</small>' : ''}</span>${e === CFG.admin || e === EMAIL ? '' : `<button type="button" class="btn ghost small danger" data-rmc="${esc(e)}">Remove</button>`}</div>`).join('')}</div>
    <form class="inline" id="addC"><input class="input" id="addCIn" type="email" placeholder="coach@gmail.com" aria-label="Coach's Google email"><button class="btn" type="submit">Add</button></form>
    <div class="dlg-a"><button type="button" class="btn primary" data-close>Done</button></div>`, d => {
    d.querySelector('#addC').onsubmit = async ev => { ev.preventDefault(); const e = d.querySelector('#addCIn').value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)){ toast('Enter their full email address.'); return; }
      try { await FB.addCoach(e); closeDialog(); coachesDialog(); toast(e + ' can now score.'); } catch(err){ toast('Couldn’t add them. Check the database rules are up to date.'); } };
    d.querySelectorAll('[data-rmc]').forEach(b => b.onclick = async () => { try { await FB.removeCoach(b.dataset.rmc); closeDialog(); coachesDialog(); } catch(err){ toast('Couldn’t remove them.'); } });
  });
}

/* older VEO links were stored on the public scoreboard; move them to the private record */
let veoMoved = false;
async function migrateVeo(){ if (veoMoved) return; veoMoved = true; const old = (RAW.matches || []).filter(m => m.veo || m.photos); if (!old.length) return;
  try { for (const m of old){ if (m.veo) await FB.setVeo(m.id, m.veo); if (m.photos) await FB.setPhotos(m.id, m.photos); } await FB.save(cur => { const n = clone(cur); (n.matches || []).forEach(m => { delete m.veo; delete m.photos; }); n.updated = Date.now(); return n; }); } catch(e){ veoMoved = false; } }

/* ---------- start ---------- */
function stamp(){ $('#updated').textContent = DATA.updated ? 'Last update ' + new Date(DATA.updated).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) : ''; }
const hm = location.hash.match(/^#m\.([A-Za-z0-9_-]+)$/); if (hm) V.open = hm[1];
$('#view').innerHTML = '<div class="empty">Connecting to the scoreboard…</div>';
$('#tabs').hidden = true;
function applyState(s){
  LASTS = s;
  if (SANDBOX){ REAL = s; return; }
  applyData(s);
}
function applyData(s){
  const base = {matches:[], schools:{}, crest:window.ERGS_CREST || ''};
  Object.keys(RAW).forEach(k => delete RAW[k]); Object.assign(RAW, base, s || {}, {crest:window.ERGS_CREST || (s && s.crest) || ''});
  const d = clone(RAW); d.demo = false; (d.matches || []).forEach(m => { m.home = canonSchool(m.home); m.away = canonSchool(m.away); }); d.matches = (d.matches || []).filter(followOK); Object.keys(DATA).forEach(k => delete DATA[k]); Object.assign(DATA, d);
  if (V.open && !DATA.matches.some(m => m.id === V.open) && !READY) V.open = null;
  READY = true; stamp(); newSinceLastLook();
  if (!$('#modal').hidden) pendingRender = true; else render();
}
// footer: coach sign-in
const signLink = document.createElement('button'); signLink.type = 'button'; signLink.className = 'signin-btn'; signLink.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Sign in';
const outLink = document.createElement('button'); outLink.type = 'button'; outLink.className = 'share-btn out-btn'; outLink.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h11"/></svg>Log out'; outLink.hidden = true;
outLink.onclick = () => { if (SANDBOX) sbExit(); act('signout', null); };
$('footer').appendChild(signLink);
// share the apps: link and QR code
const LIVE_URL = 'https://popcorn483.github.io/ergs-live/', SHORT_LIVE = 'https://popcorn483.github.io/ergs', SHORT_APP = 'https://popcorn483.github.io/ergsapp';   // short links for sharing (redirect pages on popcorn483.github.io)
const shareBtn = document.createElement('button'); shareBtn.type = 'button'; shareBtn.className = 'share-btn';
shareBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>Share the app';
shareBtn.onclick = () => { const items = [{label:'ERGS Rugby', url:SHORT_APP, file:'ergs-rugby-qr', desc:'One app for ERGS rugby. Anyone can follow live scores, fixtures and results; coaches and players sign in with Google for plays, drills, photos and team news.', shareText:'ERGS Rugby: live scores, fixtures and results, and the team app'}];
  window.ERGSShare.open({title:'Share', crest:DATA.crest, items}); };
const shareRow = document.createElement('div'); shareRow.className = 'share-row'; shareRow.append(shareBtn, outLink); $('footer').prepend(shareRow);
/* postpone or cancel a fixture, with a reason parents can see */
function offDialog(m){
  const REASONS = ['Waterlogged pitch', 'Frozen pitch', 'Bad weather', 'Opposition unable to field a team', 'School event'];
  const day = (m.ko || '').slice(0, 10), tm = m.koTbc ? '' : (m.ko || '').slice(11, 16);
  openDialog(`<h2>Postpone, cancel or move</h2><p>${esc((m.team ? m.team + ' ' : '') + m.home + ' v ' + m.away)}. Everyone following ERGS Live sees a notice straight away.</p>
    <div class="field"><span class="label">This match is</span>${seg('off', [['postponed','Postponed'],['cancelled','Cancelled'],['moved','On a new date / time']], m.off || 'postponed')}</div>
    <div id="offWhen" class="field" hidden><div class="row"><div class="field" style="flex:1;min-width:140px"><label class="label" for="offDate">New date</label><input class="input" id="offDate" type="date" value="${esc(day)}"></div>
      <div class="field" style="flex:1;min-width:110px"><label class="label" for="offTime">Kick-off</label><input class="input" id="offTime" type="time" value="${esc(tm)}"></div></div>
      <label class="check"><input type="checkbox" id="offTbc" ${m.koTbc ? 'checked' : ''}>Kick-off time to be confirmed (TBC)</label></div>
    <div class="field"><label class="label" for="offWhy">Reason (shown to everyone)</label><input class="input" id="offWhy" maxlength="80" value="${esc(m.offWhy || '')}" placeholder="Waterlogged pitch"><div class="chips-row">${REASONS.map(r => `<button type="button" class="chip-btn" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn danger" id="offGo">Save notice</button></div>`, d => {
    wireSegs(d); d.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { d.querySelector('#offWhy').value = b.dataset.r; });
    const segEl = d.querySelector('[data-seg="off"]'), when = d.querySelector('#offWhen'), go = d.querySelector('#offGo'), tbc = d.querySelector('#offTbc'), time = d.querySelector('#offTime');
    const sync = () => { const v = segEl.dataset.val || 'postponed'; when.hidden = v !== 'moved'; go.textContent = v === 'moved' ? 'Save new date' : 'Save notice'; go.className = 'btn ' + (v === 'moved' ? 'primary' : 'danger'); time.disabled = tbc.checked; };
    segEl.addEventListener('click', () => setTimeout(sync)); tbc.onchange = sync; sync();
    go.onclick = () => { const off = segEl.dataset.val || 'postponed', why = d.querySelector('#offWhy').value.trim().slice(0, 80);
      if (off === 'moved'){ const nd = d.querySelector('#offDate').value, nt = tbc.checked ? '' : time.value; if (!nd){ toast('Choose the new date.'); return; }
        closeDialog(); return save(dd => { const x = dd.matches.find(y => y.id === m.id); if (!x) return; const was = x.ko; delete x.off; delete x.offWhy; delete x.offAt;
          x.ko = nd + 'T' + (nt || '12:00'); x.koTbc = !nt; if (was && was !== x.ko) x.moved = {from:was, fromTbc:!!m.koTbc, at:Date.now(), why}; else if (x.moved) x.moved.why = why; }, m.id).then(() => toast('New date saved. Everyone can see it.')); }
      closeDialog(); save(dd => { const x = dd.matches.find(y => y.id === m.id); if (x){ x.off = off; x.offWhy = why; x.offAt = Date.now(); } }, m.id).then(() => toast(`Marked ${off}. Everyone can see the notice.`)); };
  });
}
/* install as an app: the APK on Android, Add to Home Screen instructions on iPhone (hidden once installed) */
(() => {
  const slot = $('#installSlot'); if (!slot) return;
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), android = /Android/i.test(ua);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || /\buk\.org\.ergs\.live\b/.test(document.referrer || '') || document.referrer.startsWith('android-app://');
  if (installed) return;
  if (android){ slot.innerHTML = `<a class="install-btn" href="https://github.com/popcorn483/ergs-live/releases/download/android/ERGS-Live.apk" rel="noopener"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>Android install</a>`;
    slot.querySelector('a').addEventListener('click', () => setTimeout(() => toast('Open the downloaded ERGS-Live.apk and tap Install. Allow installs from this source if asked.'), 400)); return; }
  const iosSteps = `<ol class="ios-steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button <span class="ios-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V3m0 0L8 7m4-4l4 4"/><path d="M6 11H5v10h14V11h-1"/></svg></span> at the bottom of the screen.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. ERGS Live appears on your home screen with the school crest and opens like an app.</li></ol>`;
  if (!ios){ // computers: install straight from Chrome or Edge, with phone options alongside
    let deferred = null;
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
    addEventListener('appinstalled', () => { slot.innerHTML = ''; toast('ERGS Live is installed. Open it from your desktop or Start menu.'); });
    const mac = /Macintosh/.test(ua), edge = /Edg\//.test(ua), chromium = /Chrome\//.test(ua);
    slot.innerHTML = `<button type="button" class="install-btn" id="getApp"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>Install on PC</button>`;
    $('#getApp').onclick = async () => {
      if (deferred){ deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; if (r && r.outcome === 'accepted') return; }
      const pc = chromium ? `<ol class="ios-steps"><li>In ${edge ? 'Edge' : 'Chrome'}, click the <b>install icon</b> at the right of the address bar (a small screen with an arrow), or open the <b>⋮ menu</b>${edge ? ' › <b>Apps</b> › <b>Install ERGS Live</b>' : ' › <b>Cast, save and share</b> › <b>Install page as app</b>'}.</li><li>Click <b>Install</b>. ERGS Live gets its own window and a desktop / Start menu icon.</li></ol>`
        : mac ? `<ol class="ios-steps"><li>In Safari, open the <b>File</b> menu and choose <b>Add to Dock</b>.</li><li>Click <b>Add</b>. ERGS Live opens from the Dock like an app.</li></ol>`
        : `<p>Open <b>popcorn483.github.io/ergs-live</b> in <b>Chrome</b> or <b>Edge</b> and click the install icon at the right of the address bar.</p>`;
      openDialog(`<h2>Install ERGS Live</h2><p><b>On this computer:</b></p>${pc}
      <p><b>Android:</b> open this page on the phone and tap <b>Android install</b>, or use this link:</p>
      <a class="btn primary" href="https://github.com/popcorn483/ergs-live/releases/download/android/ERGS-Live.apk" rel="noopener">Download for Android</a>
      <p><b>iPhone:</b></p>${iosSteps}
      <p class="hint">Web address: <b>popcorn483.github.io/ergs-live</b></p>
      <div class="dlg-a"><button type="button" class="btn ghost" data-close>Close</button></div>`); };
    return; }
  slot.innerHTML = `<button type="button" class="install-btn" id="iosAdd"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 15V3m0 0L8 7m4-4l4 4"/><path d="M6 11H5v10h14V11h-1"/></svg>Add to iPhone</button>`;
  $('#iosAdd').onclick = () => openDialog(`<h2>Add ERGS Live to your iPhone</h2>
    <ol class="ios-steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button <span class="ios-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V3m0 0L8 7m4-4l4 4"/><path d="M6 11H5v10h14V11h-1"/></svg></span> at the bottom of the screen.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. ERGS Live appears on your home screen with the school crest and opens like an app.</li></ol>
    <div class="dlg-a"><button type="button" class="btn primary" data-close>Got it</button></div>`);
})();
try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch(e){}
const googleIn = async () => { try { sessionStorage.setItem('ergs.toApp', '1'); } catch(e){} try { await FB.signIn(); } catch(e){ toast(/popup/.test(e && e.code || '') ? 'Allow pop-ups for this site, then try again.' : 'Sign-in didn’t finish. Try again.'); } };
// sign in: Google, or an email link for school C2k accounts (their admins block Google sign-in for outside apps)
signLink.onclick = () => { let saved = ''; try { saved = localStorage.getItem('ergs.linkEmail') || ''; } catch(e){}
  openDialog(`<h2>Sign in</h2><p>Coaches, players and supporters. Supporters can pick the squads they follow.</p>
    <button type="button" class="btn primary lk-g" id="lkGoogle">Sign in with Google</button>
    <div class="lk-or"><span>or, with a school C2k account</span></div>
    <form class="lk-form" id="lkForm"><input class="input" type="email" id="lkEmail" placeholder="you@c2ken.net" autocomplete="email" inputmode="email" value="${esc(saved)}" aria-label="Your school email"><button class="btn" type="submit" id="lkGo">Email me a link</button></form>
    <p class="lk-msg" id="lkMsg" role="status"></p>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>Close</button></div>`, d => {
    d.querySelector('#lkGoogle').onclick = () => { closeDialog(); googleIn(); };
    d.querySelector('#lkForm').onsubmit = async e => { e.preventDefault(); const go = d.querySelector('#lkGo'), msg = d.querySelector('#lkMsg'); go.disabled = true; msg.className = 'lk-msg';
      try { const em = await FB.sendLink(d.querySelector('#lkEmail').value); msg.classList.add('ok'); msg.innerHTML = `Link sent to <b>${esc(em)}</b>. Open that email on this phone or computer and tap <b>Sign in</b>. It can take a minute or two, so check Junk or Other too.`; go.textContent = 'Send again'; }
      catch(err){ msg.classList.add('bad'); msg.textContent = FB.linkMsg ? FB.linkMsg(err) : 'The link couldn’t be sent. Try again.'; }
      go.disabled = false; }; }); };
function boot(){
  const FB = window.FB;
  if (!FB){ $('#view').innerHTML = '<div class="empty">The scoreboard isn’t connected yet. (Setup: add the Firebase details to config.js.)</div>'; return; }
  FB.onState((s, exists) => { HAS_DOC = exists; applyState(s); }, err => { console.error(err); $('#view').innerHTML = '<div class="empty">Couldn’t reach the scoreboard. Check your signal; it reconnects by itself.</div>'; });
  if (FB.linkErr) setTimeout(() => toast(FB.linkErr), 800);
  FB.onAuth(async user => {
    if (FB.linkErr && !user) toast(FB.linkErr);
    EMAIL = user && user.email ? user.email.toLowerCase() : ''; ADMIN = !!EMAIL && EMAIL === String(CFG.admin || '').toLowerCase();
    let ok = ADMIN; if (EMAIL && !ok){ try { ok = await FB.isCoach(EMAIL); } catch(e){ ok = false; } }
    let pl = false; if (ok === 'noscore'){ ok = false; pl = true; }
    if (EMAIL && !ok && !pl){ try { pl = await FB.isPlayer(EMAIL); } catch(e){ pl = false; } }
    // a coach or player who has just signed in here goes on to the team app (they can come back for scoring)
    // and a coach or player opening ERGS Live fresh (the installed app, a bookmark) starts in the team app too.
    // They stay here when they came from the team app (Scores link), opened a match link, or already chose to stay this session.
    { let go = false, stay = false; try { go = sessionStorage.getItem('ergs.toApp') === '1'; if (EMAIL) sessionStorage.removeItem('ergs.toApp');
        stay = sessionStorage.getItem('ergs.liveOK') === '1' || /\/app\//.test(document.referrer || '') || /^#m\./.test(location.hash) || /[?&]live\b/.test(location.search); } catch(e){}
      if ((ok || pl) && !SANDBOX && (go || !stay)){ location.replace(new URL('app/', location.href).href); return; }
      try { if (EMAIL) sessionStorage.setItem('ergs.liveOK', '1'); } catch(e){} }
    COACH = ok; PLAYER = pl; if (COACH) loadTeams(true); signLink.hidden = !!EMAIL; outLink.hidden = !EMAIL;
    if (veoUnsub){ veoUnsub(); veoUnsub = null; } VEO = {}; PHOTOS = {};
    if (COACH || PLAYER) veoUnsub = FB.onVeo((v, ph) => { VEO = v || {}; PHOTOS = ph || {}; if (READY) render(); photoScan(); });
    const hadSup = !!SUP; SUP = null; if (hadSup) reapply();
    if (EMAIL && !ok && !pl){ toast(`Signed in as a supporter (${EMAIL}).`); supLoad().catch(() => {}); }
    else if (pl) toast('Signed in as a player. Match videos and photos are unlocked.');
    if (nomsUnsub){ nomsUnsub(); nomsUnsub = null; } NOMS = []; if (notesUnsub){ notesUnsub(); notesUnsub = null; } OPPN = {};
    if (COACH && FB.onOppNotes) notesUnsub = FB.onOppNotes(v => { OPPN = v || {}; if (READY && !$('#oppNoteIn:focus')) render(); });
    if (COACH && FB.onNoms) nomsUnsub = FB.onNoms(l => { NOMS = l; if (READY && V.open) render(); });
    if (COACH) migrateVeo();
    if (READY) render();
  });
}
if (window.FB) boot(); else window.addEventListener('fb-ready', boot, {once:true});
/* stay on the newest version: when one is published, ask to refresh (and refresh by itself next time the app is opened) */
let newVer = '';
function refreshNow(){ try { sessionStorage.setItem('ergsLive.ui', JSON.stringify({open:V.open, tab:V.tab})); } catch(e){} location.replace(location.pathname + '?v=' + newVer + location.hash); }
function askRefresh(){
  if (document.getElementById('updBar')) return;
  const b = document.createElement('div'); b.id = 'updBar'; b.className = 'upd-bar'; b.setAttribute('role', 'status');
  b.innerHTML = '<span><b>ERGS Live has been updated.</b> Refresh to get the latest version.</span><button type="button" class="btn primary">Refresh</button><button type="button" class="upd-x" aria-label="Later">×</button>';
  b.querySelector('.btn').onclick = refreshNow; b.querySelector('.upd-x').onclick = () => b.remove();
  document.body.appendChild(b); requestAnimationFrame(() => b.classList.add('on'));
}
async function checkVersion(){
  if (!window.ERGS_VER || /__VER__/.test(window.ERGS_VER)) return;
  try { const r = await fetch('version.json?t=' + Date.now(), {cache:'no-store'}); if (!r.ok) return; const v = (await r.json()).v;
    if (v && v !== window.ERGS_VER){ newVer = v; askRefresh(); } } catch(e){}
}
setInterval(checkVersion, 90000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  // coming back to the app with an update waiting: refresh straight away unless something is mid-entry
  if (newVer && !busy && !saving && $('#modal').hidden) return refreshNow();
  checkVersion();
});
setTimeout(checkVersion, 4000);
setTimeout(() => { if (!window.FB) boot(); }, 8000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && READY) render(); });
/* ---------- Team of the Week nominations: after the final whistle, coaches pick up to 4 players; the main app collates them ---------- */
const NOM_MAX = 4;
function nomsOf(m){ return NOMS.filter(x => x.mid === m.id); }
function nomBox(m){
  const l = nomsOf(m);
  return `<div class="box coach nom-box"><h3>Team of the Week</h3><p class="hint" style="margin:0">${l.length ? 'Nominated from this match:' : `Nominate up to ${NOM_MAX} players from this match. They appear on the Team of the Week screen in the main app.`}</p>
    ${l.length ? `<div class="nom-chips">${l.map(x => `<span class="nom-chip">${x.n ? `<i>${esc(x.n)}</i>` : ''}<b>${esc(x.name)}</b><small>${esc(x.team || '')}</small></span>`).join('')}</div>` : ''}
    <div class="ctrl"><button type="button" class="btn ${l.length ? '' : 'primary'}" data-act="noms">${l.length ? 'Change nominations' : 'Nominate players'}</button></div></div>`;
}
async function nomsDialog(m){
  if (!window.FB || !FB.setNoms){ toast('Nominations need the latest version. Refresh the page.'); return; }
  let players = Array.isArray(m.players) && m.players.length ? m.players.slice() : [];
  if (!players.length){ await loadTeams(); const x = TEAMS_CACHE && ((m.sheetId && TEAMS_CACHE.sheets.find(y => y.id === m.sheetId)) || sheetFor(m)); if (x) players = sheetPlayers(x); }
  const us = usOf(m), scorers = [...new Set(sorted(m).filter(e => e.s === us && e.p && e.k !== 'note').map(e => e.p))];
  scorers.forEach(n => { if (!players.some(p => p.name === n)) players.push({n:'', name:n}); });
  const cur = nomsOf(m), opp = us === 'A' ? m.home : m.away;
  const byNum = v => { const k = (String(v).trim().match(/^#?(\d{1,2})$/) || [])[1]; return k ? players.find(p => +p.n === +k) : null; };
  openDialog(`<h2>Team of the Week nominations</h2><p>${esc(m.team ? m.team + ' ' : '')}v ${esc(opp)}. Pick up to ${NOM_MAX} players${players.length ? ' (name or shirt number)' : ''}.</p>
    <div class="nom-rows">${[0,1,2,3].map(i => `<div class="field"><label class="label" for="nom${i}">Player ${i + 1}</label><input class="input" id="nom${i}" maxlength="40" list="nomNames" autocomplete="off" value="${esc(cur[i] ? cur[i].name : '')}"><span class="hint" id="nomH${i}" aria-live="polite"></span></div>`).join('')}</div>
    <datalist id="nomNames">${players.map(p => `<option value="${esc(p.name)}"${p.n ? ` label="#${esc(p.n)}"` : ''}>`).join('')}</datalist>
    <div class="field" style="max-width:220px"><label class="label" for="nomTeam">Team shown on the graphic</label><input class="input" id="nomTeam" maxlength="12" list="nomTeams" value="${esc((cur[0] && cur[0].team) || m.team || '')}"><datalist id="nomTeams">${TEAMS.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>${cur.length ? 'Cancel' : 'Later'}</button><button type="button" class="btn primary" id="nomGo">Save nominations</button></div>`, d => {
    for (let i = 0; i < NOM_MAX; i++){ const inp = d.querySelector('#nom' + i), h = d.querySelector('#nomH' + i);
      inp.oninput = () => { const p = byNum(inp.value); h.textContent = p ? `#${p.n} ${p.name}` : ''; }; }
    d.querySelector('#nomGo').onclick = async () => {
      const team = d.querySelector('#nomTeam').value.trim(), seen = new Set(), list = [];
      for (let i = 0; i < NOM_MAX; i++){ const v = d.querySelector('#nom' + i).value.trim(); if (!v) continue; const hit = byNum(v) || players.find(p => p.name.toLowerCase() === v.toLowerCase()); const name = (hit ? hit.name : v).slice(0, 40);
        if (seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase());
        const old = cur.find(x => x.name === name);
        list.push({id:old ? old.id : uid(), mid:m.id, name, n:hit && hit.n ? +hit.n : '', team, opp, date:(m.ko || '').slice(0, 10), by:EMAIL, at:old ? old.at : Date.now()}); }
      const btn = d.querySelector('#nomGo'); btn.disabled = true;
      try { await FB.setNoms(m.id, list); closeDialog(); toast(list.length ? `${list.length} ${list.length === 1 ? 'player' : 'players'} nominated for Team of the Week.` : 'Nominations removed for this match.'); }
      catch(e){ btn.disabled = false; toast(/permission/.test(e && e.code || '') ? 'The database refused the save: your account isn’t on the coaches list.' : 'That didn’t save. Try again.'); }
    };
    setTimeout(() => { const f = d.querySelector('#nom' + Math.min(cur.length, NOM_MAX - 1)); if (f) f.focus(); }, 30);
  });
}


/* ---------- opposition notes: private coach notes against each school, shown before the next fixture with them ---------- */
const oppKey = n => schoolKey(canonSchool(n || '')) || String(n || '').toLowerCase().trim();
const oppNote = n => OPPN[oppKey(n)] || null;
function oppNoteBox(m){
  const opp = usOf(m) === 'A' ? m.home : m.away, n = oppNote(opp), pre = m.status === 'pre';
  const when = n && n.u ? new Date(n.u).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}) : '';
  return `<div class="box coach opp-notes${pre && n ? ' has' : ''}"><h3>Notes on ${esc(opp)}</h3><p class="hint" style="margin:0">${pre && n ? 'From your last meeting with them. ' : ''}Only coaches can see these. They come up again before every fixture against ${esc(opp)}.</p>
    <form id="oppNoteForm" data-opp="${esc(opp)}"><textarea class="input" id="oppNoteIn" rows="${n ? 5 : 3}" maxlength="4000" placeholder="Their 10 kicks a lot; quick lineout ball; strong scrum; play wide early…" aria-label="Notes on ${esc(opp)}">${esc(n ? n.text : '')}</textarea>
    <div class="ctrl" style="margin-top:8px"><button class="btn" type="submit">Save notes</button>${when ? `<span class="hint">Last saved ${when}${n.by ? ' by ' + esc(n.by) : ''}</span>` : ''}</div></form></div>`;
}

/* ---------- demo: a practice copy of ERGS Live that only exists on this device. Coaches and players can score, see every animation
   and try the coach tools; nothing is saved or seen by anyone, and leaving puts the real scoreboard straight back ---------- */
function sbData(){
  const now = Date.now(), iso = (dd, hm) => { const d = new Date(now + dd*864e5); return new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0, 10) + 'T' + hm; };
  const P = ['Ben Jones','Tom Smith','Jack Hall','Adam Kerr','Luke Gray','Max Doyle','Ian Moore','Sam Reid','Ross Bell','Cal Weir','Dan Fox','Eli Ward','Finn Lowe','Gus Hart','Hugh Nash','Owen Park','Niall Burns','Ryan Quinn','Peter Grant','Ciaran Lee','Mark Ellis','John Ross','Adam Bell'].map((name, i) => ({n:i + 1, name}));
  const U = ['Jamie Moore','Leo Brown','Cian Kelly','Ollie Ward','Max Hunter','Rory Hall','Evan Price','Noah Quinn','Alfie Reid','Josh Lowe','Tyler Fox','Harry Doyle','Zac Gray','Ethan Bell','Liam Nash','Kai Smith','Sam Park','Luca Burns'].map((name, i) => ({n:i + 1, name}));
  let n = 0; const e = (k, s, p, m, extra) => Object.assign({id:'d' + (n++), k, s, p, m, at:m*60, ts:now - (90 - m)*60e3}, extra || {});
  return {demo:false, schools:{}, updated:now, matches:[
    {id:'demo-live', home:'ERGS', away:'Campbell College', us:'H', team:'1XV', comp:'Ulster Schools’ Cup', round:'Quarter-final', venue:'Eisenhower Playing Fields', code:'union', half:35, status:'2H', ko:iso(0, '10:30'), clock:{base:47*60, since:now, running:true}, players:P, created:now,
      events:[e('try','H','Gus Hart',6), e('con','H','Cal Weir',7), e('pen','A','',14), e('note','','Huge defensive set from the ERGS pack on our own line.',19), e('try','A','',27), e('con','A','',28, {miss:true}), e('try','H','Ross Bell',33), e('con','H','Cal Weir',34), e('yc','A','',38), e('note','','Second half under way. ERGS playing into the wind.',36)]},
    {id:'demo-ko', home:'ERGS', away:'Omagh Academy', us:'H', team:'U14', comp:'Friendly', venue:'Eisenhower Playing Fields', code:'union', half:25, status:'pre', ko:iso(0, '12:00'), clock:{base:0, since:0, running:false}, players:U, events:[], created:now + 1},
    {id:'demo-pp', home:'Royal School Dungannon', away:'ERGS', us:'A', team:'Meds', comp:'Medallion Shield', venue:'', code:'union', half:30, status:'pre', ko:iso(3, '14:00'), clock:{base:0, since:0, running:false}, events:[], created:now + 2},
    {id:'demo-r1', home:'Portora Royal School', away:'ERGS', us:'A', team:'1XV', comp:'Friendly', status:'FT', ko:iso(-7, '11:00'), ftAt:now - 7*864e5, clock:{base:4200, since:0, running:false}, created:now - 9, players:P,
      events:[e('try','A','Gus Hart',12), e('con','A','Cal Weir',13), e('pen','H','',22), e('try','A','Dan Fox',41), e('try','A','Gus Hart',58), e('pen','A','Cal Weir',66)]},
    {id:'demo-r2', home:'ERGS', away:'Coleraine Grammar School', us:'H', team:'2XV', comp:'Friendly', status:'FT', ko:iso(-14, '10:30'), ftAt:now - 14*864e5, clock:{base:4200, since:0, running:false}, created:now - 10,
      events:[e('try','A','',9), e('try','H','Sam Reid',30), e('try','A','',50), e('pen','A','',61)]}]};
}
const SB_TASKS = [
  ['Open the U14 v Omagh fixture and press Kick off', d => { const m = d.matches.find(x => x.id === 'demo-ko'); return m && m.status !== 'pre'; }],
  ['Score a try for ERGS (watch the animation)', d => d.matches.some(m => m.id === 'demo-ko' && m.events.some(e => e.k === 'try' && e.s === 'H'))],
  ['Add the conversion: scored or missed', d => d.matches.some(m => m.id === 'demo-ko' && m.events.some(e => e.k === 'con'))],
  ['Post a line of live commentary', d => d.matches.some(m => m.id === 'demo-ko' && m.events.some(e => e.k === 'note'))],
  ['Show a yellow card', d => d.matches.some(m => m.id === 'demo-ko' && m.events.some(e => e.k === 'yc' || e.k === 'rc'))],
  ['Press Half time, then Start 2nd half', d => d.matches.some(m => m.id === 'demo-ko' && ['2H', 'FT'].includes(m.status) && m.clock && m.clock.base > 0)],
  ['Blow full time and watch the celebration', d => d.matches.some(m => m.id === 'demo-ko' && m.status === 'FT')],
  ['Postpone or move the Meds fixture', d => d.matches.some(m => m.id === 'demo-pp' && (m.off || m.moved))]];
function sbFB(){
  const real = window.FB;
  return Object.assign({}, real, {
    save(fn){ SB = fn(clone(SB)); setTimeout(() => { applyData(clone(SB)); sbBar(); }); return Promise.resolve(); },
    setVeo(id, url){ VEO[id] = url; return Promise.resolve(); }, setPhotos(id, url){ PHOTOS[id] = url; return Promise.resolve(); }, setMedia(){ return Promise.resolve(); },
    setNoms(mid, list){ NOMS = NOMS.filter(x => x.mid !== mid).concat(list); setTimeout(render); return Promise.resolve(); },
    setOppNote(k, note){ OPPN = Object.assign({}, OPPN); if (note) OPPN[k] = note; else delete OPPN[k]; setTimeout(render); return Promise.resolve(); },
    setFace(){ return Promise.resolve(); }, addCoach(){ return Promise.reject({code:'demo'}); }, removeCoach(){ return Promise.reject({code:'demo'}); },
    signOut(){ sbExit(); return Promise.resolve(); } });
}
function sbEnter(){
  if (SANDBOX) return; REAL = clone(RAW); SB_ROLE = {COACH, PLAYER, ADMIN}; SB_FB = window.FB;
  try { localStorage.removeItem('ergsLive.seen.demo'); localStorage.removeItem('ergsLive.ft.demo'); } catch(e){}
  SANDBOX = true; COACH = true; window.FB = sbFB(); SB = sbData(); V.open = null; V.tab = 'matches';
  applyData(clone(SB)); scrollTo(0, 0); toast('Demo on. Practise freely: nothing here is saved or seen by anyone.');
}
function sbExit(){
  if (!SANDBOX) return; SANDBOX = false; window.FB = SB_FB; COACH = SB_ROLE.COACH; PLAYER = SB_ROLE.PLAYER; ADMIN = SB_ROLE.ADMIN; SB = null; V.open = null; Q.length = 0;
  try { localStorage.removeItem('ergsLive.seen.demo'); localStorage.removeItem('ergsLive.ft.demo'); } catch(e){}
  try { history.replaceState(null, '', location.pathname + location.search); } catch(e){}
  applyData(REAL || {matches:[], schools:{}}); scrollTo(0, 0); toast('Back to the real scoreboard.');
}
function sbAnimations(){ const m = DATA.matches.find(x => x.id === 'demo-live'); if (!m) return; const pick = k => sorted(m).find(e => e.k === k);
  [pick('try'), pick('con'), m.events.find(e => e.k === 'con' && e.miss), pick('pen'), pick('yc')].filter(Boolean).forEach(e => Q.push([m, e])); Q.push([Object.assign({}, m, {status:'FT'}), {id:'ft-demo', k:'ft', s:'H', ts:Date.now()}]);
  if (!busy){ busy = true; playFx(); } }
function sbBar(){
  let bar = $('#sbBar');
  if (!bar){ bar = document.createElement('div'); bar.id = 'sbBar'; bar.className = 'sb-bar'; $('#coachBar').before(bar); }
  // the way in, for coaches and players
  let fl = $('#sbFloat'); if (!fl){ fl = document.createElement('div'); fl.id = 'sbFloat'; fl.className = 'sb-float'; fl.innerHTML = '<span>Demo</span><button type="button">Leave</button>'; document.body.appendChild(fl); fl.querySelector('button').onclick = () => sbExit(); }
  fl.hidden = !SANDBOX;
  bar.hidden = !SANDBOX; if (!SANDBOX) return;
  const done = SB_TASKS.map(([t, f]) => !!(SB && f(SB))), n = done.filter(Boolean).length;
  bar.innerHTML = `<div class="sb-top"><span class="sb-tag">Demo</span><span class="sb-msg"><b>Practice mode.</b> Score, post commentary and try every coach tool. Nothing is saved or seen by anyone.</span>
      <div class="ctrl"><button type="button" class="btn" id="sbAnim">Watch the animations</button><button type="button" class="btn ghost" id="sbSteps">${SB_STEPS ? 'Hide' : 'Show'} the steps (${n}/${SB_TASKS.length})</button><button type="button" class="btn primary" id="sbExit">Leave the demo</button></div></div>
    ${SB_STEPS ? `<ol class="sb-steps">${SB_TASKS.map(([t], i) => `<li class="${done[i] ? 'done' : ''}">${esc(t)}</li>`).join('')}</ol>${n === SB_TASKS.length ? '<p class="sb-win">All done! You know your way round ERGS Live. Leave the demo to get back to the real scores.</p>' : ''}` : ''}`;
  $('#sbExit').onclick = sbExit; $('#sbAnim').onclick = sbAnimations; $('#sbSteps').onclick = () => { SB_STEPS = !SB_STEPS; sbBar(); };
}
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#sbGo1, #sbGo2')) sbEnter(); });
// coaches' risky tools are switched off in the demo
const actReal = act;
act = function(a, m){ if (SANDBOX && ['coaches', 'signout', 'seed', 'cleardemo', 'import'].includes(a)){ toast('That isn’t available in the demo. Leave the demo first.'); return; } return actReal(a, m); };

/* ---------- school crests: every school in the database, with merge and delete ---------- */
const sameSchool = (a, b) => !!a && !!b && canonSchool(a) === canonSchool(b);
const schMatches = n => DATA.matches.filter(m => sameSchool(usOf(m) === 'A' ? m.home : m.away, n) || sameSchool(m.home, n) || sameSchool(m.away, n));
function schListHTML(list){
  if (!list.length) return '<div class="empty">No schools yet. Add one above, or add a match and its opponent appears here.</div>';
  const rec = n => Object.values(DATA.schools || {}).some(v => v && v.name && sameSchool(v.name, n));
  const rows = list.map(n => { const s0 = school(n) || {}, c = schMatches(n).length; return {n, s:s0, crest:!!s0.crest, c, mine:c > 0 || rec(n)}; }), miss = rows.filter(r => !r.crest).length;
  const played = rows.filter(r => r.c), pMiss = played.filter(r => !r.crest).length;
  const f = ['missing', 'played', 'all'].includes(V.schFilter) ? V.schFilter : 'all';
  const show = f === 'missing' ? rows.filter(r => !r.crest) : f === 'played' ? played : rows;
  return `<div class="sch-tools"><span class="hint"><b>${rows.length}</b> schools · <b class="${miss ? 'miss' : ''}">${miss} without a crest</b>${played.length ? ` · ${pMiss ? `<b class="miss">${pMiss}</b>` : 'none'} of the ${played.length} you’ve played` : ''}</span>
      <div class="seg"><button type="button" data-schf="all" aria-pressed="${f === 'all'}">All (${rows.length})</button><button type="button" data-schf="missing" aria-pressed="${f === 'missing'}">No crest (${miss})</button><button type="button" data-schf="played" aria-pressed="${f === 'played'}">Played (${played.length})</button></div></div>
    ${show.length ? '' : '<div class="empty">Nothing to show here.</div>'}${(DATA.removedSchools || []).length ? `<p class="hint sch-gone">Removed: ${DATA.removedSchools.map(n => `<button type="button" class="lnk" data-restore="${esc(n)}">${esc(n)} (restore)</button>`).join(' · ')}</p>` : ''}
    <div class="schs">${show.map(({n, s, crest:has, c, mine}) => `<div class="sch${has ? '' : ' no-crest'}">${crest(n)}<span class="sch-n"><b>${esc(n)}</b><small>${c ? `${c} match${c === 1 ? '' : 'es'}` : 'Not played yet'}${has ? '' : ' · <em>No crest</em>'}${Array.isArray(s.aliases) && s.aliases.length ? ' · also “' + esc(s.aliases.slice(0, 2).join('”, “')) + '”' : ''}</small></span>
      <label class="btn ${has ? 'ghost' : ''} small">${has ? 'Change' : 'Add crest'}<input type="file" accept="image/*" hidden data-crest="${esc(n)}"></label>
      <input type="color" value="${esc(s.color || '#3A4466')}" data-col="${esc(n)}" aria-label="Colour for ${esc(n)}">
      ${mine ? `<button type="button" class="btn ghost small" data-merge="${esc(n)}">Merge</button>` : ''}
      ${has ? `<button type="button" class="btn ghost small" data-delcrest="${esc(n)}" aria-label="Remove ${esc(n)} crest">Remove crest</button>` : ''}
      <button type="button" class="btn ghost small danger" data-delsch="${esc(n)}">Delete</button></div>`).join('')}</div>`;
}
async function schReopen(done){ for (let i = 0; i < 25 && !done(); i++) await new Promise(r => setTimeout(r, 100)); schoolsDialog(); }
function schMergeDialog(from, list){
  const others = list.filter(n => n !== from), c = schMatches(from).length;
  openDialog(`<h2>Merge ${esc(from)}</h2><p>Use this when the same school has been entered twice, for example a typo or a short name. ${c ? `Its ${c} match${c === 1 ? '' : 'es'} move` : 'It moves'} to the school you choose, and “${esc(from)}” is remembered as another name for it.</p>
    <div class="field"><label class="label" for="mgTo">Merge into</label><select class="input" id="mgTo">${others.map(n => `<option>${esc(n)}</option>`).join('')}</select></div>
    <div class="dlg-a"><button type="button" class="btn ghost" id="mgBack">Back</button><button type="button" class="btn primary" id="mgGo">Merge</button></div>`, d => {
    d.querySelector('#mgBack').onclick = schoolsDialog;
    d.querySelector('#mgGo').onclick = async () => { const to = d.querySelector('#mgTo').value; if (!to) return; closeDialog();
      await save(dd => { dd.schools = dd.schools || {}; const kTo = schoolKey(to), src = Object.entries(dd.schools).filter(([k, v]) => k === schoolKey(from) || (v && v.name && sameSchool(v.name, from)));
        const tgt = dd.schools[kTo] = Object.assign({name:to}, dd.schools[kTo]);
        src.forEach(([k, v]) => { if (!tgt.crest && v && v.crest){ tgt.crest = v.crest; tgt.color = tgt.color || v.color; } (v && Array.isArray(v.aliases) ? v.aliases : []).forEach(a => tgt.aliases = [...new Set((tgt.aliases || []).concat(a))]); if (k !== kTo) delete dd.schools[k]; });
        tgt.aliases = [...new Set((tgt.aliases || []).concat(from))].filter(a => !sameSchool(a, to) || a !== to);
        dd.matches.forEach(m => { if (sameSchool(m.home, from)) m.home = to; if (sameSchool(m.away, from)) m.away = to; }); });
      toast(`${from} merged into ${to}.`); schReopen(() => !DATA.matches.some(m => m.home === from || m.away === from) && !Object.values(DATA.schools || {}).some(v => v && v.name === from)); };
  });
}
function schDeleteDialog(n){
  const ms = schMatches(n), c = ms.length;
  openDialog(`<h2>Delete ${esc(n)}?</h2>${c ? `<p><b>${esc(n)} has ${c} match${c === 1 ? '' : 'es'}</b> (${esc(ms.slice(0, 3).map(m => (m.team ? m.team + ' ' : '') + new Date(kot(m) || Date.now()).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'})).join(', '))}${c > 3 ? '…' : ''}). If it’s the same school under another name, use Merge instead so those results are kept.</p>` : `<p>${esc(n)} has no matches. It comes off the list${ULSTER.some(u => sameSchool(u, n)) ? ' and the Add a school suggestions (you can restore it at the bottom of the list)' : ''}, along with its crest and colour.</p>`}
    <div class="dlg-a"><button type="button" class="btn ghost" id="dsBack">Back</button>${c ? `<button type="button" class="btn" id="dsMerge">Merge instead</button>` : ''}<button type="button" class="btn danger" id="dsGo">${c ? `Delete school and ${c} match${c === 1 ? '' : 'es'}` : 'Delete school'}</button></div>`, d => {
    d.querySelector('#dsBack').onclick = schoolsDialog;
    const mg = d.querySelector('#dsMerge'); if (mg) mg.onclick = () => { const names = new Set(); DATA.matches.forEach(m => [m.home, m.away].forEach(x => { if (x && !OUR_RX.test(x)) names.add(canonSchool(x)); })); Object.values(DATA.schools || {}).forEach(v => v && v.name && names.add(canonSchool(v.name))); schMergeDialog(n, [...names].sort()); };
    d.querySelector('#dsGo').onclick = async () => { const ids = new Set(ms.map(m => m.id)); closeDialog();
      await save(dd => { Object.keys(dd.schools || {}).forEach(k => { const v = dd.schools[k]; if (k === schoolKey(n) || (v && v.name && sameSchool(v.name, n))) delete dd.schools[k]; }); dd.matches = dd.matches.filter(m => !ids.has(m.id)); if (ULSTER.some(u => sameSchool(u, n))) dd.removedSchools = [...new Set((dd.removedSchools || []).concat(canonSchool(n)))]; });
      toast(c ? `${n} and ${c} match${c === 1 ? '' : 'es'} deleted.` : `${n} deleted.`); schReopen(() => !schMatches(n).length && !Object.values(DATA.schools || {}).some(v => v && v.name && sameSchool(v.name, n)) && (!ULSTER.some(u => sameSchool(u, n)) || (DATA.removedSchools || []).some(x => sameSchool(x, n)))); };
  });
}

/* ---------- the ☰ menu: the team app first, then everything else, so the coach view stays clean ---------- */
const ICON = {photo:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>', app:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>', plus:'<path d="M12 5v14M5 12h14"/>', past:'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/><path d="M12 7v5l3 2"/>', imp:'<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v3h16v-3"/>', crest:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', people:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5c2.6.2 4.6 1.9 5.3 5"/>', demo:'<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>', share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>', out:'<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h11"/>', in:'<path d="M9 4H5v16h4"/><path d="M14 8l4 4-4 4M18 12H7"/>'};
const ic = k => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
function menuOpen(){
  let dr = $('#drawer'); if (!dr){ dr = document.createElement('div'); dr.id = 'drawer'; dr.className = 'drawer'; dr.hidden = true; document.body.appendChild(dr);
    dr.addEventListener('click', e => { if (e.target === dr) menuClose(); }); document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dr.hidden) menuClose(); }); }
  const squad = (COACH || PLAYER) && !SANDBOX, real = SANDBOX ? SB_ROLE : {COACH, PLAYER};
  const item = (k, t, sub, attr) => `<button type="button" class="dr-item" ${attr}>${ic(k)}<span><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  dr.innerHTML = `<nav class="dr-panel" aria-label="Menu"><div class="dr-head"><img alt="" src="${esc(DATA.crest || '')}"><div><b>ERGS Live</b><small>${EMAIL ? esc(EMAIL) + ' · ' + (real.COACH ? 'Coach' : real.PLAYER ? 'Player' : 'Supporter') : 'Live scores, fixtures and results'}</small></div><button type="button" class="dr-x" aria-label="Close menu">✕</button></div>
    ${squad || (SANDBOX && (real.COACH || real.PLAYER)) ? `<a class="dr-app" href="${esc(MAIN_APP)}" target="_blank" rel="noopener">${ic('app')}<span><b>Open the ERGS Rugby app</b><small>Plays, drills, photos, graphics and team news</small></span><span class="dr-arrow">↗</span></a>` : ''}
    ${COACH && !SANDBOX ? `<div class="dr-sec">Matches</div>${item('plus', 'New match', 'Add a fixture to score', 'data-mact="new"')}${item('past', 'Add a past result', 'A score from before ERGS Live', 'data-mact="past"')}${item('imp', 'Import fixtures', 'From a photo, PDF or list', 'data-mact="import"')}
      <div class="dr-sec">Manage</div>${item('crest', 'School crests', 'Crests, colours, merge and delete', 'data-mact="schools"')}${item('people', 'Coaches', 'Who can score and manage', 'data-mact="coaches"')}` : ''}
    ${(real.COACH || real.PLAYER) ? `<div class="dr-sec">Learn</div>${SANDBOX ? item('demo', 'Leave the demo', 'Back to the real scoreboard', 'data-mdemo="out"') : item('demo', real.COACH ? 'Practise in the demo' : 'Try the demo', 'Score a match and see the animations. Nothing is saved', 'data-mdemo="in"')}` : ''}
    <div class="dr-sec">More</div>${item('share', 'Share the app', 'Link and QR code', 'data-mshare')}${document.querySelector('#installSlot button, #installSlot a') ? item('imp', 'Install the app', 'On your phone or computer', 'data-minst') : ''}
    ${EMAIL ? item('out', 'Sign out', '', 'data-mout') : item('in', 'Coach & player sign in', 'With your Google account', 'data-min')}</nav>`;
  dr.querySelector('.dr-x').onclick = menuClose;
  dr.querySelectorAll('[data-mact]').forEach(b => b.onclick = () => { menuClose(); act(b.dataset.mact, null); });
  dr.querySelectorAll('[data-mdemo]').forEach(b => b.onclick = () => { menuClose(); b.dataset.mdemo === 'in' ? sbEnter() : sbExit(); });
  const sh = dr.querySelector('[data-mshare]'); if (sh) sh.onclick = () => { menuClose(); shareBtn.click(); };
  const so = dr.querySelector('[data-mout]'); if (so) so.onclick = () => { menuClose(); if (SANDBOX) sbExit(); act('signout', null); };
  const ins = dr.querySelector('[data-minst]'); if (ins) ins.onclick = () => { menuClose(); const t = document.querySelector('#installSlot button, #installSlot a'); if (t) t.click(); };
  const si = dr.querySelector('[data-min]'); if (si) si.onclick = () => { menuClose(); signLink.click(); };
  dr.hidden = false; document.body.classList.add('dr-lock'); requestAnimationFrame(() => dr.classList.add('on')); const f = dr.querySelector('.dr-app, .dr-item'); if (f) f.focus();
}
function menuClose(){ const dr = $('#drawer'); if (!dr) return; dr.classList.remove('on'); document.body.classList.remove('dr-lock'); setTimeout(() => { dr.hidden = true; }, 220); }
(() => {
  const hd = document.querySelector('header'); if (!hd) return;
  const wrap = document.createElement('div'); wrap.className = 'hd-menu';
  wrap.innerHTML = `<a class="hd-app" id="hdApp" href="${esc(MAIN_APP)}" target="_blank" rel="noopener" hidden>${ic('app')}<span>Team app</span></a><button type="button" class="hd-burger" id="hdBurger" aria-label="Menu" aria-haspopup="dialog"><span></span><span></span><span></span></button>`;
  hd.appendChild(wrap);
  $('#hdBurger').onclick = menuOpen;
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-menu]')) menuOpen(); });
  const sync = () => { const a = $('#hdApp'); if (a) a.hidden = !((COACH || PLAYER) && !SANDBOX); };
  setInterval(sync, 800); sync();
})();
/* hop between ERGS Live and the team app in the same tab (or window, when installed) instead of opening a new one every time */
(() => { const standalone = () => { try { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true; } catch(e){ return false; } };
  document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (!a || e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    let u; try { u = new URL(a.href, location.href); } catch(x){ return; } if (u.origin !== location.origin || !/^\/ergs/.test(u.pathname)) return;
    e.preventDefault(); location.href = u.href; }, true); })();
/* ---------- Danske Bank Ulster Schools' Cup: group tables, live, with what ERGS need (coaches and players) ---------- */
// Kept in the scoreboard record (DATA.cup) so supporters see the live tables. Coaches set the groups once (paste them from the Ulster Rugby site)
// and add other schools' results; ERGS's own group games fill in from the matches scored here, live.
const CUP_RULES = {win:4, draw:2, tb:4, lb:7, winners:6, runners:4};
const cupOf = () => DATA.cup && Array.isArray(DATA.cup.groups) ? DATA.cup : null;
const cupR = () => Object.assign({}, CUP_RULES, (cupOf() || {}).rules || {});
// one key per school however it's written: "Larne GS", "Larne Grammar School", "RS Dungannon", "Royal School Dungannon"
const cupKey = n => { let x = ' ' + String(canonSchool(n) || n || '').toLowerCase().replace(/[’'`.]/g, '').replace(/[^a-z0-9]+/g, ' ') + ' ';
  x = x.replace(/ gs /g, ' grammar school ').replace(/ hs /g, ' high school ').replace(/ rs /g, ' royal school ').replace(/ es /g, ' ').replace(/ coll /g, ' college ').replace(/ acad /g, ' academy ');
  const w = x.split(' ').filter(t => t && !/^(the|of|and|school|grammar|high|college|academy|integrated|secondary|boys|girls)$/.test(t)); return w.join(' ') || x.trim(); };
const cupOurs = n => OUR_RX.test(n || '');
const cupSeasonY = () => { const c = cupOf(); const y = c && +(String(c.season || '').match(/20\d\d/) || [0])[0]; return y || (new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1); };
const cupShort = n => String(n || '').replace(/\bGS\b/g, 'Grammar School').replace(/\bHS\b/g, 'High School').replace(/\bES\b/g, 'Endowed School').replace(/^RS\b/, 'Royal School').replace(/\bColl\b/g, 'College').replace(/\bAcad\b/g, 'Academy').replace(/\s+/g, ' ').trim();   // full school names, never cut short
const triesOf = (m, s) => { const n = (m.events || []).filter(e => e.s === s && (e.k === 'try' || e.k === 'pt') && !e.miss).length; return n || !Array.isArray(m.finalTries) ? n : (+m.finalTries[s === 'H' ? 0 : 1] || 0); };
/* is this one of our group games? a Cup match (or one with no competition set) against a school in the group, this season, 1st XV */
const cupIsGroupGame = m => teamCode(m.team) === '1XV' && seasonOf(m) === cupSeasonY() && !/medallion|girls|bowl|shield|plate|trophy|friendly|subsidiary/i.test(m.comp || '') && (/cup/i.test(m.comp || '') || !String(m.comp || '').trim());
// when a table was pasted, our results already in it are the ones finished before the paste; anything finished or added after goes on top
const cupAfterBase = (m, B) => !B || isLive(m) || (m.ftAt || m.created || kot(m) || 0) > (B.t || 0);
/* our group games, straight from the scoreboard (1st XV, a "Cup" competition, this season) */
function cupOurGames(g){
  const mates = g.teams.filter(t => !cupOurs(t)); if (mates.length === g.teams.length) return [];
  const out = [];
  DATA.matches.filter(m => usOf(m) && (m.status === 'FT' || isLive(m)) && cupIsGroupGame(m) && cupAfterBase(m, cupBase(g))).forEach(m => {
    const us = usOf(m), opp = us === 'A' ? m.home : m.away, mate = mates.find(t => cupKey(t) === cupKey(opp)); if (!mate) return;
    const [h, a] = score(m), ours = g.teams.find(cupOurs);
    out.push({id:'m:' + m.id, h:us === 'H' ? ours : mate, a:us === 'H' ? mate : ours, hs:h, as:a, ht:triesOf(m, 'H'), at:triesOf(m, 'A'), live:isLive(m), auto:true, mid:m.id}); });
  return out;
}
// a table pasted from the Ulster Rugby site: the starting point, with later results added on top
const cupBase = g => g && g.base && g.base.by ? g.base : null;   // each group keeps its own pasted table
function cupGames(g){
  const B = cupBase(g), ours = cupOurGames(g), key = (x, y) => [cupKey(x), cupKey(y)].sort().join('|'), have = new Set(ours.map(x => key(x.h, x.a)));
  return ours.concat(((cupOf() || {}).games || []).filter(x => x.g === g.n && x.hs !== '' && x.hs != null && x.as !== '' && x.as != null && !have.has(key(x.h, x.a)) && (!B || (x.t || 0) > (B.t || 0))).map(x => Object.assign({}, x, {hs:+x.hs, as:+x.as})));
}
function cupTable(g, games){
  const R = cupR(), B = cupBase(g), T = new Map(g.teams.map(t => [cupKey(t), Object.assign({n:t, P:0, W:0, D:0, L:0, F:0, A:0, TB:0, LB:0, Pts:0, live:false}, B && B.by[cupKey(t)] ? B.by[cupKey(t)] : {})]));
  (games || cupGames(g)).forEach(x => { const H = T.get(cupKey(x.h)), A = T.get(cupKey(x.a)); if (!H || !A) return;
    [[H, x.hs, x.as, x.ht], [A, x.as, x.hs, x.at]].forEach(([o, f, a, tr]) => { o.P++; o.F += f; o.A += a; if (f > a){ o.W++; o.Pts += R.win; } else if (f === a){ o.D++; o.Pts += R.draw; } else { o.L++; if (a - f <= R.lb){ o.LB++; o.Pts++; } }
      if (tr != null && tr !== '' && +tr >= R.tb){ o.TB++; o.Pts++; } if (x.live) o.live = true; }); });
  return [...T.values()].sort((a, b) => b.Pts - a.Pts || (b.F - b.A) - (a.F - a.A) || b.F - a.F || a.n.localeCompare(b.n));
}
/* the group games still to play: everyone plays everyone once */
function cupLeft(g, games){ const k = (x, y) => [cupKey(x), cupKey(y)].sort().join('|'), done = new Set(games.filter(x => !x.live).map(x => k(x.h, x.a))), out = [];
  for (let i = 0; i < g.teams.length; i++) for (let j = i + 1; j < g.teams.length; j++) if (!done.has(k(g.teams[i], g.teams[j]))) out.push([g.teams[i], g.teams[j]]);
  const B = cupBase(g); if (!B) return out;
  // the pasted table only gives games played, so pick the remaining fixtures that fit each school's count (ERGS's own fixtures on the scoreboard decide between options)
  const need = new Map(g.teams.map(t => [cupKey(t), Math.max(0, g.teams.length - 1 - ((B.by[cupKey(t)] || {}).P || 0) - games.filter(x => !x.live && (cupKey(x.h) === cupKey(t) || cupKey(x.a) === cupKey(t))).length)]));
  const ourKey = cupKey(g.teams.find(cupOurs) || ''), mine = new Set(), played = new Set();
  DATA.matches.filter(m => usOf(m) && cupIsGroupGame(m)).forEach(m => { const o = cupKey(usOf(m) === 'A' ? m.home : m.away); (m.status === 'pre' ? mine : played).add([ourKey, o].sort().join('|')); });
  let best = null, bestS = -1e9;
  for (let mask = 0; mask < (1 << out.length); mask++){ const pick = out.filter((_, i) => mask & (1 << i)), cnt = new Map();
    pick.forEach(([a, b]) => { cnt.set(cupKey(a), (cnt.get(cupKey(a)) || 0) + 1); cnt.set(cupKey(b), (cnt.get(cupKey(b)) || 0) + 1); });
    if (![...need].every(([t, n]) => (cnt.get(t) || 0) === n)) continue;
    const sc = pick.reduce((a, [x, y]) => a + (mine.has(k(x, y)) ? 2 : 0) - (played.has(k(x, y)) ? 5 : 0), 0); if (sc > bestS){ bestS = sc; best = pick; } }
  return best || out; }
/* every way the remaining games could go: where could ERGS finish? */
function cupScenarios(g){
  const R = cupR(), games = cupGames(g).filter(x => !x.live), left = cupLeft(g, games), ours = g.teams.find(cupOurs); if (!ours || !left.length || left.length > 6) return null;
  const bonus = left.length <= 3;
  // outcome kinds for one game: [home pts, away pts, label]
  const kinds = []; const W = R.win, D = R.draw;
  if (bonus){ for (const wb of [0, 1]) for (const lb of [0, 1]) for (const lt of [0, 1]) { kinds.push({r:'H', h:W + wb, a:lb + lt}); kinds.push({r:'A', h:lb + lt, a:W + wb}); } for (const b1 of [0, 1]) for (const b2 of [0, 1]) kinds.push({r:'D', h:D + b1, a:D + b2}); }
  else kinds.push({r:'H', h:W, a:0}, {r:'A', h:0, a:W}, {r:'D', h:D, a:D});
  const base = new Map(cupTable(g, games).map(o => [cupKey(o.n), o.Pts])), ok = cupKey(ours);
  const byCombo = new Map(); let best = 9, worst = 0, maxPts = base.get(ok);
  const rec = (i, pts, mine) => {
    if (i === left.length){ const me = pts.get(ok); let above = 0, tie = 0; pts.forEach((v, k) => { if (k === ok) return; if (v > me) above++; else if (v === me) tie++; });
      const b = above + 1, w = above + tie + 1, key = mine.join('|'); const c = byCombo.get(key) || {best:9, worst:0, ptsMin:99, ptsMax:0}; c.best = Math.min(c.best, b); c.worst = Math.max(c.worst, w); c.ptsMin = Math.min(c.ptsMin, me); c.ptsMax = Math.max(c.ptsMax, me); byCombo.set(key, c);
      best = Math.min(best, b); worst = Math.max(worst, w); maxPts = Math.max(maxPts, me); return; }
    const [h, a] = left[i], kh = cupKey(h), ka = cupKey(a), us = kh === ok ? 'H' : ka === ok ? 'A' : '';
    const seen = new Set();
    for (const k of kinds){ const next = new Map(pts); next.set(kh, next.get(kh) + k.h); next.set(ka, next.get(ka) + k.a);
      const res = us ? (k.r === 'D' ? 'D' : k.r === us ? 'W' : 'L') : ''; const tag = us ? (us === 'H' ? a : h) + ':' + res : '';
      if (!us){ const sig = k.r + k.h + ',' + k.a; if (seen.has(sig)) continue; seen.add(sig); }
      rec(i + 1, next, us ? mine.concat([tag]) : mine); } };
  rec(0, base, []);
  return {left, bonus, best, worst, maxPts, now:base.get(ok), combos:[...byCombo.entries()].map(([k, v]) => Object.assign({k:k ? k.split('|').map(x => { const i = x.lastIndexOf(':'); return {opp:x.slice(0, i), r:x.slice(i + 1)}; }) : []}, v)).sort((a, b) => a.best - b.best || a.worst - b.worst)};
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
function viewCup(){
  const c = cupOf(), squad = COACH || PLAYER, R = cupR();
  if (!c || !c.groups.length) return `<div class="empty">The Schools’ Cup group tables appear here once the groups are set.${COACH ? '<div class="ctrl" style="justify-content:center;margin-top:10px"><button type="button" class="btn primary" data-cup="paste">Paste tables from Ulster Rugby</button><button type="button" class="btn" data-cup="setup">Set up the groups</button></div>' : ''}</div>`;
  const tables = c.groups.map(g => { const games = cupGames(g); return {g, games, t:cupTable(g, games)}; });
  const ourG = tables.find(x => x.g.teams.some(cupOurs));
  // the race for the best runners-up
  const ru = tables.map(x => x.t[1] && Object.assign({grp:x.g.n}, x.t[1])).filter(Boolean).sort((a, b) => b.Pts - a.Pts || (b.F - b.A) - (a.F - a.A) || b.F - a.F);
  const anyLive = tables.some(x => x.games.some(y => y.live));
  const tbl = x => `<div class="cup-g${x.g.teams.some(cupOurs) ? ' ours' : ''}"><div class="cup-gh"><b>Group ${esc(x.g.n)}</b>${x.games.some(y => y.live) ? '<span class="pill live">Live</span>' : ''}${COACH ? `<button type="button" class="lnk cup-ed" data-cupres="${esc(x.g.n)}">Results</button>` : ''}</div>${cupBase(x.g) ? `<p class="cup-src">Ulster Rugby table from ${esc(new Date(cupBase(x.g).t).toLocaleDateString('en-GB', {day:'numeric', month:'short'}))}${x.games.length ? ` + ${x.games.length} result${x.games.length === 1 ? '' : 's'} added since: ${x.games.map(y => `${esc(cupShort(y.h))} ${y.hs}–${y.as} ${esc(cupShort(y.a))}`).join(', ')}` : ''}</p>` : ''}
    <div class="tbl"><table class="cup-t"><thead><tr><th></th><th class="l">School</th><th>P</th><th>W</th><th>D</th><th>L</th><th class="hide-s">PD</th><th class="hide-s" title="Try bonus">TB</th><th class="hide-s" title="Losing bonus">LB</th><th>Pts</th></tr></thead><tbody>
    ${x.t.map((o, i) => { const ri = ru.findIndex(r => r.grp === x.g.n), q = i === 0 ? 'q' : i === 1 && ri >= 0 && ri < R.runners ? 'q2' : ''; return `<tr class="${cupOurs(o.n) ? 'us ' : ''}${q}"><td class="pos">${i + 1}</td><td class="l"><span class="who">${crest(o.n)}<span>${esc(cupShort(o.n))}</span>${o.live ? '<span class="dot"></span>' : ''}</span></td><td>${o.P}</td><td>${o.W}</td><td>${o.D}</td><td>${o.L}</td>${o.P && !o.F && !o.A ? '<td class="hide-s">–</td><td class="hide-s">–</td><td class="hide-s">–</td>' : `<td class="hide-s">${o.F - o.A > 0 ? '+' : ''}${o.F - o.A}</td><td class="hide-s">${o.TB}</td><td class="hide-s">${o.LB}</td>`}<td class="pts">${o.Pts}</td></tr>`; }).join('')}</tbody></table></div>
    ${COACH && V.cupEdit ? cupEditList(x.g) : x.games.length ? `<details class="cup-res"><summary>${x.games.length} result${x.games.length === 1 ? '' : 's'}</summary>${x.games.map(y => `<div class="cup-r${y.live ? ' live' : ''}"><span>${esc(cupShort(y.h))}</span><b>${y.hs}–${y.as}</b><span>${esc(cupShort(y.a))}</span>${y.live ? '<span class="pill live">Live</span>' : ''}</div>`).join('')}</details>` : ''}</div>`;
  let need = '';
  if (squad && ourG){ const sc = cupScenarios(ourG.g), pos = ourG.t.findIndex(o => cupOurs(o.n)) + 1, me = ourG.t[pos - 1];
    const res = r => r === 'W' ? 'Beat' : r === 'D' ? 'Draw with' : 'Lose to';
    const fin = (b, w) => b === w ? ordinal(b) : `${ordinal(b)}–${ordinal(w)}`;
    const verdict = (b, w) => w === 1 ? ['yes', 'Group winners: through to the Last 16'] : b === 1 && w === 2 ? ['maybe', 'Top two: winners or a runner-up place'] : b === 1 ? ['maybe', 'Could still win the group, depends on other results'] : b === 2 ? ['maybe', 'Best case runners-up: needs to be one of the best ' + R.runners] : ['no', 'Can’t finish in the top two'];
    if (!sc) need = `<div class="box cup-need"><h3>What ERGS need <span class="pill">Coaches &amp; players</span></h3><p>${cupLeft(ourG.g, ourG.games).length ? 'Too many games left to work out every result yet.' : `Group finished: ERGS are <b>${ordinal(pos)}</b> in Group ${esc(ourG.g.n)} on ${me.Pts} points. ${pos === 1 ? 'Through as group winners.' : pos === 2 ? (ru.findIndex(r => r.grp === ourG.g.n) < R.runners ? `Currently one of the best ${R.runners} runners-up.` : `Outside the best ${R.runners} runners-up for now.`) : 'Not through to the Last 16.'}`}</p></div>`;
    else { const [vk, vt] = verdict(sc.best, sc.worst);
      need = `<div class="box cup-need"><h3>What ERGS need <span class="pill">Coaches &amp; players</span></h3>
        <div class="cup-now"><div><b>${ordinal(pos)}</b><span>Now</span></div><div><b>${sc.now}</b><span>Points</span></div><div><b>${sc.maxPts}</b><span>Most possible</span></div><div class="v-${vk}"><b>${fin(sc.best, sc.worst)}</b><span>Can finish</span></div></div>
        <p class="cup-v v-${vk}">${esc(vt)}</p>
        ${sc.combos.length > 1 || (sc.combos[0] && sc.combos[0].k.length) ? `${sc.combos.length > 6 ? `<details class="cup-more"><summary>Every result for ERGS (${sc.combos.length})</summary>` : ''}<div class="cup-sc">${sc.combos.map(o => { const [k2, t2] = verdict(o.best, o.worst); return `<div class="sc v-${k2}"><span class="sc-if">${o.k.map(x => `${res(x.r)} ${esc(cupShort(x.opp))}`).join(', ')}</span><span class="sc-then"><b>${fin(o.best, o.worst)}</b> · ${o.ptsMin === o.ptsMax ? o.ptsMin : o.ptsMin + '–' + o.ptsMax} pts · ${esc(t2.split(':')[0])}</span></div>`; }).join('')}</div>${sc.combos.length > 6 ? '</details>' : ''}` : ''}
        <p class="hint">Win ${R.win} pts, draw ${R.draw}, +1 for ${R.tb} or more tries, +1 for losing by ${R.lb} or less. ${sc.bonus ? 'Every bonus point combination is counted.' : 'With this many games left, bonus points aren’t counted yet.'} Level on points counts as a range, because ties are decided by the competition rules. The ${R.winners} group winners and the ${R.runners} best runners-up go through to the Last 16.</p></div>`; } }
  const ruBox = ru.length > 1 ? `<div class="box cup-ru"><h3>Best runners-up <small>top ${R.runners} go through</small></h3><ol>${ru.map((o, i) => `<li class="${i < R.runners ? 'in' : ''}${cupOurs(o.n) ? ' us' : ''}"><span>${esc(cupShort(o.n))} <small>Group ${esc(o.grp)}</small></span><b>${o.Pts}</b><small>${o.F - o.A > 0 ? '+' : ''}${o.F - o.A}</small></li>`).join('')}</ol></div>` : '';
  return `<div class="cup-head"><div><div class="sec" style="margin:0 0 4px">${esc(c.name || 'Danske Bank Ulster Schools’ Cup')}${c.season ? ' · ' + esc(c.season) : ''}</div><p class="hint" style="margin:0">Group stage tables${anyLive ? ', updating live' : ''}. ${R.winners} winners and the ${R.runners} best runners-up reach the Last 16.</p></div>${COACH ? `<div class="ctrl"><button type="button" class="btn ${V.cupEdit ? 'primary' : ''}" data-cup="edit" aria-pressed="${!!V.cupEdit}">${V.cupEdit ? 'Done editing' : 'Edit results'}</button><button type="button" class="btn ghost" data-cup="paste">Paste tables</button><button type="button" class="btn ghost" data-cup="setup">Edit groups</button></div>` : ''}</div>${COACH && V.cupEdit ? '<p class="cup-edhint">Type each score and the tries straight into the tables below. Each result saves for everyone as soon as you leave the box. ERGS games fill in from the scoreboard.</p>' : ''}
    ${need}${ourG ? tbl(ourG) : ''}<div class="cup-grid">${tables.filter(x => x !== ourG).map(tbl).join('')}</div>${ruBox}
    ${c.exempt && c.exempt.length ? `<p class="hint">Straight into the Last 16: ${esc(c.exempt.join(', '))}.</p>` : ''}${c.source ? `<p class="hint">Groups from <a href="${esc(c.source)}" target="_blank" rel="noopener">Ulster Rugby</a>.</p>` : ''}`;
}
/* coaches: paste the groups (as they appear on the Ulster Rugby site) */
function cupSetup(){
  const c = cupOf() || {}, R = cupR();
  const txt = (c.groups || []).map(g => `Group ${g.n}: ${g.teams.join(', ')}`).join('\n');
  openDialog(`<h2>Schools’ Cup groups</h2><p class="hint">Open the <a href="https://ulster.rugby/clubs-landing-page/domestic-fixtures-results" target="_blank" rel="noopener">Ulster Rugby fixtures &amp; results page</a>, select the Schools’ Cup group tables (headings and all), copy and paste them below. The points so far come across too, and ERGS games and results you add later go on top. Plain lists work as well: <i>Group F: Enniskillen Royal GS, Portadown College, RS Dungannon, Larne GS</i>.</p>
    <div class="row2"><div class="field"><label class="label" for="cuName">Competition</label><input class="input" id="cuName" value="${esc(c.name || 'Danske Bank Ulster Schools’ Cup')}"></div><div class="field"><label class="label" for="cuSeason">Season</label><input class="input" id="cuSeason" value="${esc(c.season || seasonLabel(cupSeasonY()))}" placeholder="2026/27"></div></div>
    <div class="field"><label class="label" for="cuGroups">Groups</label><textarea class="input" id="cuGroups" rows="8" placeholder="Group A: …">${esc(txt)}</textarea></div>
    <div class="field"><label class="label" for="cuExempt">Straight into the Last 16 (optional)</label><input class="input" id="cuExempt" value="${esc((c.exempt || []).join(', '))}" placeholder="Ballymena Academy, Campbell College, …"></div>
    <details class="links-x"><summary>Points and qualifying</summary><div class="row2"><div class="field"><label class="label" for="cuW">Win</label><input class="input" id="cuW" type="number" min="0" value="${R.win}"></div><div class="field"><label class="label" for="cuD">Draw</label><input class="input" id="cuD" type="number" min="0" value="${R.draw}"></div></div>
      <div class="row2"><div class="field"><label class="label" for="cuTb">Try bonus: tries needed</label><input class="input" id="cuTb" type="number" min="1" value="${R.tb}"></div><div class="field"><label class="label" for="cuLb">Losing bonus: within</label><input class="input" id="cuLb" type="number" min="0" value="${R.lb}"></div></div>
      <div class="row2"><div class="field"><label class="label" for="cuWin">Group winners through</label><input class="input" id="cuWin" type="number" min="0" value="${R.winners}"></div><div class="field"><label class="label" for="cuRu">Best runners-up through</label><input class="input" id="cuRu" type="number" min="0" value="${R.runners}"></div></div></details>
    <div class="field"><label class="label" for="cuSrc">Link to the Ulster Rugby page (optional)</label><input class="input" id="cuSrc" type="url" value="${esc(c.source || '')}" placeholder="https://ulster.rugby/…"></div>
    <p class="hint" id="cuMsg"></p>
    <div class="dlg-a">${c.groups && c.groups.length ? '<button type="button" class="btn ghost danger" id="cuDel">Remove the tables</button><span style="flex:1"></span>' : ''}<button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="cuGo">Save</button></div>`, d => {
    const parse = () => parseCup(d.querySelector('#cuGroups').value).groups.map((g, i) => Object.assign({}, g, {n:g.n || '?'}));
    const show = () => { const g = parse(); const pc = parseCup(d.querySelector('#cuGroups').value); d.querySelector('#cuMsg').textContent = (pc.base ? `Table found with points for ${Object.keys(pc.base).length} schools. ` : '') + (g.length ? `${g.length} group${g.length === 1 ? '' : 's'}: ${g.map(x => x.n + ' (' + x.teams.length + ')').join(', ')}${g.some(x => x.teams.some(cupOurs)) ? '. ERGS found in Group ' + g.find(x => x.teams.some(cupOurs)).n + '.' : '. ERGS isn’t in any group yet.'}` : ''); };
    d.querySelector('#cuGroups').addEventListener('input', show); show();
    const del = d.querySelector('#cuDel'); if (del) del.onclick = () => { closeDialog(); ask('Remove the Schools’ Cup tables?', 'The groups and results come off ERGS Live for everyone.', 'Remove', () => save(dd => { delete dd.cup; }, null)); };
    d.querySelector('#cuGo').onclick = () => { const pc = parseCup(d.querySelector('#cuGroups').value), groups = pc.groups; groups.forEach((g, i) => { if (!g.n) g.n = 'ABCDEFGHIJKL'.split('').find(x => !groups.some(y => y.n === x)) || String(i + 1); delete g.auto; }); if (!groups.length){ toast('Paste at least one group.'); return; }
      const n = id => Math.max(0, +d.querySelector(id).value || 0);
      const cup = {name:d.querySelector('#cuName').value.trim(), season:d.querySelector('#cuSeason').value.trim(), groups, exempt:d.querySelector('#cuExempt').value.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean).map(canonSchool),
        rules:{win:n('#cuW'), draw:n('#cuD'), tb:Math.max(1, n('#cuTb')), lb:n('#cuLb'), winners:n('#cuWin'), runners:n('#cuRu')}, source:/^https:\/\//.test(d.querySelector('#cuSrc').value.trim()) ? d.querySelector('#cuSrc').value.trim() : '', games:(c.games || []).filter(x => !(pc.base && groups.some(g => g.n === x.g && g.teams.some(t => pc.base[cupKey(t)])))), updated:Date.now()};
      cupApplyBase(cup.groups, pc.base, c.groups);
      closeDialog(); V.tab = 'cup'; save(dd => { dd.cup = cup; }, null).then(() => toast('Schools’ Cup groups saved. Everyone can see the tables.')); };
  });
}
/* coaches: results for one group (ERGS's own games fill in from the scoreboard) */
function cupResults(gn){
  const c = cupOf(); if (!c) return; const g = c.groups.find(x => x.n === gn); if (!g) return;
  const ours = cupOurGames(g), k = (x, y) => [cupKey(x), cupKey(y)].sort().join('|'), auto = new Map(ours.map(x => [k(x.h, x.a), x]));
  const pairs = []; for (let i = 0; i < g.teams.length; i++) for (let j = i + 1; j < g.teams.length; j++) pairs.push([g.teams[i], g.teams[j]]);
  const cur = (h, a) => (c.games || []).find(x => x.g === gn && k(x.h, x.a) === k(h, a));
  openDialog(`<h2>Group ${esc(gn)} results</h2><p class="hint">Score and tries for each game. Tries decide the try bonus (${cupR().tb}+). ERGS games come from the scoreboard automatically.</p>
    <div class="cup-in">${pairs.map(([h, a], i) => { const au = auto.get(k(h, a)); if (au) return `<div class="cup-ir auto"><span>${esc(cupShort(au.h))}</span><b>${au.hs}–${au.as}</b><span>${esc(cupShort(au.a))}</span><small>${au.live ? 'Live on ERGS Live' : 'From ERGS Live'} · tries ${au.ht}–${au.at}</small></div>`;
      const x = cur(h, a) || {}, sw = x.h && cupKey(x.h) !== cupKey(h), H = sw ? a : h, A = sw ? h : a;
      return `<div class="cup-ir" data-i="${i}" data-h="${esc(H)}" data-a="${esc(A)}"><span>${esc(cupShort(H))}</span><input class="input" type="number" min="0" aria-label="${esc(H)} score" data-f="hs" value="${esc(x.hs != null ? x.hs : '')}"><input class="input" type="number" min="0" aria-label="${esc(A)} score" data-f="as" value="${esc(x.as != null ? x.as : '')}"><span>${esc(cupShort(A))}</span>
        <small>Tries <input class="input tr" type="number" min="0" aria-label="${esc(H)} tries" data-f="ht" value="${esc(x.ht != null ? x.ht : '')}"> – <input class="input tr" type="number" min="0" aria-label="${esc(A)} tries" data-f="at" value="${esc(x.at != null ? x.at : '')}"></small></div>`; }).join('')}</div>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="crGo">Save results</button></div>`, d => {
    d.querySelector('#crGo').onclick = () => { const list = (c.games || []).filter(x => x.g !== gn);
      d.querySelectorAll('.cup-ir[data-i]').forEach(r => { const v = f => { const s = r.querySelector(`[data-f="${f}"]`).value.trim(); return s === '' ? '' : Math.max(0, +s); };
        const o = {id:uid(), g:gn, h:r.dataset.h, a:r.dataset.a, hs:v('hs'), as:v('as'), ht:v('ht'), at:v('at'), t:Date.now()}; if (o.hs !== '' && o.as !== '') list.push(o); });
      closeDialog(); save(dd => { if (dd.cup){ dd.cup.games = list; dd.cup.updated = Date.now(); } }, null).then(() => toast(`Group ${gn} updated for everyone.`)); };
  });
}
/* the Schools' Cup tab: shown to everyone once the groups are set (coaches always) */
(() => {
  const tabs = $('#tabs'); if (!tabs) return;
  const b = document.createElement('button'); b.type = 'button'; b.dataset.v = 'cup'; b.textContent = 'Schools’ Cup'; b.hidden = true; tabs.appendChild(b);
  b.onclick = () => { V.tab = 'cup'; render(); };
  setInterval(() => { b.hidden = !(cupOf() && cupOf().groups.length) && !COACH; if (b.hidden && V.tab === 'cup'){ V.tab = 'matches'; render(); } }, 700);
  document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[data-cup], [data-cupres]'); if (!t) return; if (t.dataset.cup === 'setup') cupSetup(); else if (t.dataset.cup === 'paste') cupPaste(); else if (t.dataset.cup === 'edit'){ V.cupEdit = !V.cupEdit; render(); } else if (t.dataset.cupres) cupResults(t.dataset.cupres); });
})();

/* inline results for coaches: every fixture in the group, score and tries, saved on leaving the box */
const cupPair = (x, y) => [cupKey(x), cupKey(y)].sort().join('|');
function cupEditList(g){
  const auto = new Map(cupOurGames(g).map(x => [cupPair(x.h, x.a), x])), games = ((cupOf() || {}).games || []).filter(x => x.g === g.n), rows = [];
  for (let i = 0; i < g.teams.length; i++) for (let j = i + 1; j < g.teams.length; j++){
    const h0 = g.teams[i], a0 = g.teams[j], au = auto.get(cupPair(h0, a0));
    if (au){ rows.push(`<div class="cup-er auto"><span class="h">${esc(cupShort(au.h))}</span><b>${au.hs}</b><b>${au.as}</b><span class="a">${esc(cupShort(au.a))}</span><span class="t">${au.live ? '<span class="pill live">Live</span>' : 'From ERGS Live'} · <button type="button" class="lnk" data-open="${esc(au.mid)}">Open match</button></span></div>`); continue; }
    const x = games.find(y => cupPair(y.h, y.a) === cupPair(h0, a0)) || {}, sw = x.h && cupKey(x.h) !== cupKey(h0), H = sw ? a0 : h0, A = sw ? h0 : a0, v = k => x[k] == null ? '' : x[k], done = v('hs') !== '' && v('as') !== '';
    rows.push(`<div class="cup-er${done ? ' done' : ''}" data-g="${esc(g.n)}" data-h="${esc(H)}" data-a="${esc(A)}"><span class="h">${esc(cupShort(H))}</span>
      <input class="input sc" inputmode="numeric" data-f="hs" aria-label="${esc(H)} score" placeholder="–" value="${esc(v('hs'))}"><input class="input sc" inputmode="numeric" data-f="as" aria-label="${esc(A)} score" placeholder="–" value="${esc(v('as'))}"><span class="a">${esc(cupShort(A))}</span>
      <span class="t">Tries <input class="input tr" inputmode="numeric" data-f="ht" aria-label="${esc(H)} tries" placeholder="0" value="${esc(v('ht'))}"> – <input class="input tr" inputmode="numeric" data-f="at" aria-label="${esc(A)} tries" placeholder="0" value="${esc(v('at'))}">
      <button type="button" class="lnk cup-sw" data-cupsw title="Swap home and away">⇄</button>${done ? '<button type="button" class="lnk cup-x" data-cupx title="Clear this result">Clear</button>' : ''}</span></div>`); }
  return `<div class="cup-ed-list">${rows.join('')}</div>`;
}
function cupSaveRow(r, opts){
  const val = f => { const s = r.querySelector(`[data-f="${f}"]`).value.trim(); return s === '' || isNaN(+s) ? '' : Math.max(0, Math.round(+s)); };
  let h = r.dataset.h, a = r.dataset.a, o = {hs:val('hs'), as:val('as'), ht:val('ht'), at:val('at')};
  if (opts && opts.swap){ [h, a] = [a, h]; o = {hs:o.as, as:o.hs, ht:o.at, at:o.ht}; }
  if (opts && opts.clear) o = {hs:'', as:'', ht:'', at:''};
  const gn = r.dataset.g, key = cupPair(h, a);
  return save(dd => { if (!dd.cup) return; const list = (dd.cup.games || []).filter(x => !(x.g === gn && cupPair(x.h, x.a) === key));
    if (o.hs !== '' || o.as !== '' || (opts && opts.swap)) list.push(Object.assign({id:uid(), g:gn, h, a, t:Date.now()}, o));
    dd.cup.games = list; dd.cup.updated = Date.now(); }, null).then(() => { r.classList.add('saved'); if (o.hs !== '' && o.as !== '') toast(`${cupShort(h)} ${o.hs}–${o.as} ${cupShort(a)} saved.`); }).catch(() => toast('That didn’t save. Try again.'));
}
(() => {
  // save when a box is left (or Enter); hold back redraws while a coach is typing so nothing is lost
  document.addEventListener('change', e => { const r = e.target.closest && e.target.closest('.cup-er[data-g]'); if (!r) return; cupSaveRow(r); });
  document.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const r = e.target.closest && e.target.closest('.cup-er[data-g]'); if (!r) return; e.preventDefault();
    const ins = [...document.querySelectorAll('.cup-er[data-g] input')], i = ins.indexOf(e.target); (ins[i + 1] || e.target).focus(); if (ins[i + 1]) ins[i + 1].select(); });
  document.addEventListener('click', e => { const sw = e.target.closest && e.target.closest('[data-cupsw], [data-cupx]'); if (!sw) return; const r = sw.closest('.cup-er[data-g]'); if (!r) return;
    if (sw.hasAttribute('data-cupx')) ask('Clear this result?', `${cupShort(r.dataset.h)} v ${cupShort(r.dataset.a)} comes off the table for everyone.`, 'Clear', () => cupSaveRow(r, {clear:true})); else cupSaveRow(r, {swap:true}); });
  document.addEventListener('focusout', () => setTimeout(() => { if (V.cupWait && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('.cup-er'))){ V.cupWait = false; render(); } }, 150));
  const r0 = render; render = function(){ const a = document.activeElement; if (V.tab === 'cup' && a && a.closest && a.closest('.cup-er[data-g]')){ V.cupWait = true; return; } return r0.apply(this, arguments); };
})();

/* read the group draw or the tables as copied from the Ulster Rugby site (tabs, spaces or one cell per line) */
function parseCup(text){
  const groups = [], base = {}; let cur = null, cols = null, pend = null, vh = [];
  const COLS = {pos:'', position:'', team:'', p:'P', pl:'P', played:'P', w:'W', won:'W', d:'D', drawn:'D', l:'L', lost:'L', f:'F', pf:'F', for:'F', a:'A', pa:'A', against:'A', pd:'PD', diff:'PD', '+/-':'PD', tb:'TB', lb:'LB', bp:'BP', b:'BP', bonus:'BP', pts:'Pts', points:'Pts', q:'Q'};
  const finish = () => { if (!pend || !cur) { pend = null; return; } const nums = pend.nums; if (nums.length >= 4){
      let order = cols && cols.length ? cols.slice(cols.length > nums.length ? cols.length - nums.length : 0) : nums.length >= 9 ? ['P', 'W', 'D', 'L', 'F', 'A', 'TB', 'LB', 'Pts'] : nums.length === 8 ? ['P', 'W', 'D', 'L', 'F', 'A', 'BP', 'Pts'] : nums.length === 7 ? ['P', 'W', 'D', 'L', 'F', 'A', 'Pts'] : nums.length === 5 ? ['P', 'W', 'D', 'L', 'Pts'] : ['P', 'W', 'D', 'L'];
      const o = {P:0, W:0, D:0, L:0, F:0, A:0, TB:0, LB:0, Pts:0}; order.forEach((c, i) => { if (nums[i] == null) return; if (c === 'BP') o.TB = nums[i]; else if (c in o) o[c] = nums[i]; });
      if (!order.includes('Pts')) o.Pts = o.W*4 + o.D*2; base[cupKey(cupOurs(pend.name) ? 'ERGS' : pend.name)] = o; }
    cur.teams.push(pend.name); pend = null; };
  String(text || '').split(/\r?\n/).map(l => l.replace(/ /g, ' ').trim()).filter(Boolean).forEach(l => {
    const gm = l.match(/^(?:group|pool)\s*([A-Z0-9]{1,2})\b\s*[:\-–.]?\s*(.*)$/i);
    if (gm){ finish(); cur = {n:gm[1].toUpperCase(), teams:[]}; groups.push(cur); cols = null; if (gm[2] && !/\bpts\b/i.test(gm[2])) gm[2].split(/\s*[,;]\s*|\s+v\s+|\t/).map(x => x.trim()).filter(Boolean).forEach(t => cur.teams.push(t)); return; }
    const hk0 = l.toLowerCase().split(/[\s\t]+/).map(x => COLS[x]).filter(Boolean);
    if (!cur && !(hk0.length >= 4 && hk0.includes('P')) && !/\d/.test(l) && !/\t/.test(l) && l.split(',').length < 2 && !/^(pos|team)/i.test(l)) return;
    if (!cur || (hk0.length >= 4 && hk0.includes('P') && cur.teams.length && cur.auto)){ finish(); cur = {n:'', teams:[], auto:true}; groups.push(cur); }
    const toks = l.split(/\t+|\s{2,}/).map(x => x.trim()).filter(Boolean);
    // a header row: Team P W D L F A TB LB Pts
    const hk = hk0; if (hk.length >= 4 && hk.includes('P')){ finish(); cols = hk.filter(c => c !== 'Q'); return; }
    if (/^(team|school|club|pos|position|#)$/i.test(l) || COLS[l.toLowerCase()] !== undefined){ finish(); const c1 = COLS[l.toLowerCase()]; if (c1){ vh.push(c1); if (vh.length >= 4 && vh.includes('P')) cols = vh.filter(c => c !== 'Q').slice(); } else if (/^(pos|position|team|school|club|#)$/i.test(l) && vh.length >= 4) vh = []; return; }
    vh = [];
    // numbers only: cells of the row above, one per line
    if (/^[+\-−]?\d+(\s+[+\-−]?\d+)*$/.test(l) && pend){ l.split(/\s+/).forEach(x => pend.nums.push(+x.replace('−', '-'))); return; }
    if (/^\d{1,2}$/.test(l) && !pend) return;   // a position number on its own line
    const clean = l.replace(/\s+Q\b.*$/i, '').replace(/\((winner|runner[- ]up|q)[^)]*\)/ig, '').trim();
    const rm = clean.replace(/\t/g, ' ').match(/^(?:\d{1,2}[.)]?\s+)?(.+?)\s+((?:[+\-−]?\d+\s+){3,}[+\-−]?\d+)\s*\*?$/);
    if (rm){ finish(); pend = {name:rm[1].replace(/\*+$/, '').replace(/\s+(1st|2nd|3rd|first|second)\s*XV$/i, '').trim(), nums:rm[2].trim().split(/\s+/).map(x => +x.replace('−', '-'))}; finish(); return; }
    if (toks.length > 1 && !/\d/.test(l)){ finish(); toks.forEach(t => cur.teams.push(t)); return; }
    finish(); clean.split(/\s*[,;]\s*/).map(x => x.replace(/^\d+[.)]?\s*/, '').trim()).filter(Boolean).forEach((t, i, arr) => { if (arr.length === 1) pend = {name:t.replace(/\s+(1st|2nd|3rd|first|second)\s*XV$/i, ''), nums:[]}; else cur.teams.push(t); });
  });
  finish();
  groups.forEach(g => { g.teams = [...new Set(g.teams.filter(t => t && !/^(team|school|pts)$/i.test(t)).map(t => cupOurs(t) || /enniskillen/i.test(t) ? 'ERGS' : canonSchool(t)))]; });
  // standings keyed by the names the groups end up with
  const by = {}; Object.keys(base).forEach(k => { by[k] = base[k]; });
  groups.forEach(g => g.teams.forEach(t => { const raw = Object.keys(base).find(k => k === cupKey(t)); if (raw) by[cupKey(t)] = base[raw]; }));
  return {groups:groups.filter(g => g.teams.length >= 2), base:Object.keys(base).length ? by : null};
}

/* put a pasted table's numbers on the groups they belong to (a table without a heading finds its group by its schools) */
function cupApplyBase(groups, base, old){
  if (!base) return; const now = Date.now(), day = ymd(new Date());
  groups.forEach(g => { const by = {}; g.teams.forEach(t => { if (base[cupKey(t)]) by[cupKey(t)] = base[cupKey(t)]; });
    if (Object.keys(by).length) g.base = {asOf:day, t:now, by}; else { const o = (old || []).find(x => x.n === g.n); if (o && o.base) g.base = o.base; } });
}
/* the quick way: paste one or more tables copied from the Ulster Rugby page; matching groups update, new ones are added */
function cupPaste(){
  openDialog(`<h2>Paste tables from Ulster Rugby</h2><p class="hint">On the <a href="https://ulster.rugby/clubs-landing-page/domestic-fixtures-results" target="_blank" rel="noopener">Ulster Rugby fixtures &amp; results page</a>, highlight a group table (from POS to the last row), copy it, and paste it here. Paste one group or several. Each table updates the group with the same schools, or adds a new group.</p>
    <div class="field"><label class="label" for="cpIn">Tables</label><textarea class="input" id="cpIn" rows="9" placeholder="POS  TEAM  P  W  D  L  PTS&#10;1  Coleraine Grammar School 1st XV  2  2  0  0  9"></textarea></div>
    <div class="cup-prev" id="cpPrev"></div>
    <div class="dlg-a"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="cpGo" disabled>Update the tables</button></div>`, d => {
    const ta = d.querySelector('#cpIn'), go = d.querySelector('#cpGo'), prev = d.querySelector('#cpPrev');
    const plan = () => { const pc = parseCup(ta.value), c = cupOf() || {groups:[]}, used = new Set(c.groups.map(g => g.n)), out = [];
      pc.groups.forEach(pg => { let tgt = pg.n ? c.groups.find(g => g.n === pg.n) : null;
        if (!tgt){ let best = null, bn = 0; c.groups.forEach(g => { const n = pg.teams.filter(t => g.teams.some(u => cupKey(u) === cupKey(t))).length; if (n > bn){ bn = n; best = g; } }); if (bn >= 2) tgt = best; }
        let name = tgt ? tgt.n : pg.n; if (!name){ name = 'ABCDEFGHIJKL'.split('').find(x => !used.has(x)); } used.add(name);
        out.push({n:name, teams:pg.teams, update:!!tgt}); });
      return {pc, out}; };
    const show = () => { const {pc, out} = plan(); go.disabled = !out.length;
      prev.innerHTML = out.length ? out.map(g => `<div class="cp-g"><b>Group ${esc(g.n)}</b> <span class="pill">${g.update ? 'update' : 'new'}</span><ol>${g.teams.map(t => { const o = pc.base && pc.base[cupKey(t)]; return `<li><span>${esc(cupShort(t))}</span>${o ? `<small>P ${o.P} · W ${o.W} · D ${o.D} · L ${o.L} · <b>${o.Pts} pts</b></small>` : ''}</li>`; }).join('')}</ol>${!g.update && (cupOf() || {groups:[]}).groups.length ? '<p class="hint">No group has these schools yet, so this becomes a new group. Rename it in Edit groups if needed.</p>' : ''}</div>`).join('') : (ta.value.trim() ? '<p class="hint">No table found yet. Copy from the POS heading down to the last school.</p>' : '');
    };
    ta.addEventListener('input', show); ta.addEventListener('paste', () => setTimeout(show, 0)); setTimeout(() => ta.focus(), 30);
    go.onclick = () => { const {pc, out} = plan(); if (!out.length) return; closeDialog(); V.tab = 'cup';
      save(dd => { const c = dd.cup || (dd.cup = {name:'Danske Bank Ulster Schools’ Cup', season:seasonLabel(cupSeasonY()), groups:[], games:[], rules:{}});
        out.forEach(p => { let g = c.groups.find(x => x.n === p.n); if (!g){ g = {n:p.n, teams:[]}; c.groups.push(g); }
          p.teams.forEach(t => { if (!g.teams.some(u => cupKey(u) === cupKey(t))) g.teams.push(t); });
          if (pc.base){ const by = {}; g.teams.forEach(t => { if (pc.base[cupKey(t)]) by[cupKey(t)] = pc.base[cupKey(t)]; }); if (Object.keys(by).length){ g.base = {asOf:ymd(new Date()), t:Date.now(), by}; c.games = (c.games || []).filter(x => x.g !== g.n); } } });
        c.groups.sort((a, b) => a.n.localeCompare(b.n)); c.updated = Date.now(); }, null).then(() => toast(`${out.length} table${out.length === 1 ? '' : 's'} updated for everyone.`)); };
  });
}

})();
