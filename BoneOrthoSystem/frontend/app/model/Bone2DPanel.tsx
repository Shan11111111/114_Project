// frontend/app/model/Bone2DPanel.tsx
'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react';

type ViewMode = 'front' | 'back';
type SideMode = 'left' | 'right' | 'both';

type Bone2DRegionKey =
    | 'head-neck'
    | 'thorax-back'
    | 'upper-limb'
    | 'pelvis'
    | 'lower-limb';

type Props = {
    selectedBoneName?: string | null;
    onRegionClick?: (regionKey: Bone2DRegionKey) => void;
    locale?: string;
    viewControls?: React.ReactNode;
    onViewChange?: (view: ViewMode) => void;
};

type DotPosition = {
    x: number;
    y: number;
};

type SidePair = {
    left: string;
    right: string;
};

type DotPair = {
    left: DotPosition;
    right: DotPosition;
};

type Bone2DTarget = {
    labelZh: string;
    labelEn: string;
    defaultView: ViewMode;
    frontDot?: DotPosition;
    backDot?: DotPosition;
    frontDotPair?: DotPair;
    backDotPair?: DotPair;
};

//const HIGHLIGHT_DIR = '/anatomy/highlights';

function normalizeBoneKey(name?: string | null) {
    if (!name) return '';

    const raw = name.toLowerCase();

    // 腕骨特例要先判斷，避免「頭狀骨」被 raw.includes('頭') 誤判成 head
    // 也避免手腕舟狀骨 Scaphoid 被下面 foot 判斷吃掉
    if (
        raw.includes('scaphoid') ||
        raw.includes('lunate') ||
        raw.includes('triquetrum') ||
        raw.includes('pisiform') ||
        raw.includes('trapezium') ||
        raw.includes('trapezoid') ||
        raw.includes('capitate') ||
        raw.includes('hamate') ||
        raw.includes('腕') ||
        raw.includes('腕骨') ||
        raw.includes('月狀骨') ||
        raw.includes('三角骨') ||
        raw.includes('豆狀骨') ||
        raw.includes('大多角骨') ||
        raw.includes('小多角骨') ||
        raw.includes('頭狀骨') ||
        raw.includes('鉤狀骨') ||
        (
            raw.includes('舟狀骨') &&
            (
                raw.includes('scaphoid') ||
                raw.includes('upper limbs') ||
                raw.includes('upper limb') ||
                raw.includes('上肢')
            )
        )
    ) {
        return 'wrist';
    }

    if (
        raw.includes('hyoid') ||
        raw.includes('hyoid bone') ||
        raw.includes('舌骨')
    ) {
        return 'hyoid';
    }

    if (
        raw.includes('malleus') ||
        raw.includes('incus') ||
        raw.includes('stapes') ||
        raw.includes('ossicle') ||
        raw.includes('ossicles') ||
        raw.includes('middle ear') ||
        raw.includes('聽小骨') ||
        raw.includes('砧骨') ||
        raw.includes('錘骨') ||
        raw.includes('槌骨') ||
        raw.includes('鐙骨')
    ) {
        return 'middleEar';
    }


    if (
        raw.includes('skull') ||
        raw.includes('cranium') ||
        raw.includes('frontal') ||
        raw.includes('parietal') ||
        raw.includes('temporal') ||
        raw.includes('occipital') ||
        raw.includes('sphenoid') ||
        raw.includes('ethmoid') ||
        raw.includes('zygomatic') ||
        raw.includes('maxilla') ||
        raw.includes('mandible') ||
        raw.includes('nasal') ||
        raw.includes('hyoid') ||
        raw.includes('頭') ||
        raw.includes('顱') ||
        raw.includes('額骨') ||
        raw.includes('蝶骨') ||
        raw.includes('篩骨') ||
        raw.includes('顳骨') ||
        raw.includes('頂骨') ||
        raw.includes('枕骨') ||
        raw.includes('顴骨') ||
        raw.includes('鼻骨') ||
        raw.includes('上顎') ||
        raw.includes('下顎') ||
        raw.includes('下頜')
    ) {
        return 'head';
    }

    if (
        raw.includes('ear') ||
        raw.includes('malleus') ||
        raw.includes('incus') ||
        raw.includes('stapes') ||
        raw.includes('ossicle') ||
        raw.includes('聽小骨') ||
        raw.includes('砧骨') ||
        raw.includes('錘骨') ||
        raw.includes('槌骨') ||
        raw.includes('鐙骨')
    ) {
        return 'head';
    }

    if (raw.includes('clavicle') || raw.includes('鎖骨')) return 'clavicle';
    if (raw.includes('scapula') || raw.includes('肩胛')) return 'scapula';

    if (raw.includes('sternum') || raw.includes('胸骨')) return 'sternum';

    /**
     * 肋骨分段：
     * Rib 1-2  → upperRibs
     * Rib 3-7  → midRibs
     * Rib 8-12 → lowerRibs
     */
    const ribMatch =
        raw.match(/\brib\s*0?([1-9]|1[0-2])\b/i) ||
        raw.match(/\brib0?([1-9]|1[0-2])\b/i) ||
        raw.match(/第\s*([一二三四五六七八九十十二0-9]+)\s*肋/);

    function parseRibNo(v?: string) {
        if (!v) return null;

        const zhMap: Record<string, number> = {
            一: 1,
            二: 2,
            三: 3,
            四: 4,
            五: 5,
            六: 6,
            七: 7,
            八: 8,
            九: 9,
            十: 10,
            十一: 11,
            十二: 12,
        };

        if (zhMap[v]) return zhMap[v];

        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    const ribNo = parseRibNo(ribMatch?.[1]);

    if (ribNo !== null) {
        if (ribNo <= 2) return 'upperRibs';
        if (ribNo <= 7) return 'midRibs';
        return 'lowerRibs';
    }

    if (raw.includes('rib') || raw.includes('ribs') || raw.includes('肋骨') || raw.includes('肋')) {
        return 'midRibs';
    }

    const compactRaw = raw.replace(/\s+/g, '');

    if (
        raw.includes('cervical') ||
        raw.includes('頸椎') ||
        /\bc[1-7]\b/i.test(raw) ||
        /^c[1-7]$/i.test(compactRaw)
    ) {
        return 'cervicalSpine';
    }

    if (
        raw.includes('thoracic') ||
        raw.includes('胸椎') ||
        /\bt([1-9]|1[0-2])\b/i.test(raw) ||
        /^t([1-9]|1[0-2])$/i.test(compactRaw)
    ) {
        return 'thoracicSpine';
    }

    if (
        raw.includes('lumbar') ||
        raw.includes('腰椎') ||
        /\bl[1-5]\b/i.test(raw) ||
        /^l[1-5]$/i.test(compactRaw)
    ) {
        return 'lumbarSpine';
    }

    if (
        raw.includes('sacrum') ||
        raw.includes('coccyx') ||
        raw.includes('sacral') ||
        raw.includes('coccygeal') ||
        raw.includes('薦骨') ||
        raw.includes('骶骨') ||
        raw.includes('尾骨') ||
        raw.includes('尾椎') ||
        raw.includes('薦椎') ||
        raw.includes('骶椎')
    ) {
        return 'sacrococcyx';
    }

    if (
        raw.includes('humerus') ||
        raw.includes('humeri') ||
        raw.includes('upper arm') ||
        raw.includes('上臂') ||
        raw.includes('肱骨')
    ) {
        return 'upperArm';
    }

    if (
        raw.includes('radius') ||
        raw.includes('radii') ||
        raw.includes('ulna') ||
        raw.includes('ulnae') ||
        raw.includes('forearm') ||
        raw.includes('前臂') ||
        raw.includes('橈骨') ||
        raw.includes('尺骨')
    ) {
        return 'forearm';
    }

    /**
 * 腳趾要先於 finger / foot 判斷。
 * 因為腳趾也可能叫 phalanx / phalanges。
 */
    if (
        raw.includes('toe') ||
        raw.includes('toes') ||
        raw.includes('hallux') ||
        raw.includes('趾骨') ||
        raw.includes('腳趾') ||
        raw.includes('足趾') ||
        (
            (
                raw.includes('foot') ||
                raw.includes('feet') ||
                raw.includes('足') ||
                raw.includes('腳')
            ) &&
            (
                raw.includes('phalanx') ||
                raw.includes('phalanges')
            )
        )
    ) {
        return 'toe';
    }


    if (
        raw.includes('metatarsal') ||
        raw.includes('metatarsals') ||
        raw.includes('蹠骨')
    ) {
        return 'midFoot';
    }

    // 足部跗骨：不能只看到「舟狀骨」就判 foot，因為手腕也有舟狀骨 Scaphoid
    if (
        raw.includes('foot') ||
        raw.includes('feet') ||
        raw.includes('lower limbs') ||
        raw.includes('lower limb') ||
        raw.includes('lowerlimbs') ||
        raw.includes('lowerlimb') ||
        raw.includes('下肢') ||
        raw.includes('足') ||
        raw.includes('腳') ||
        raw.includes('tarsus') ||
        raw.includes('tarsal') ||
        raw.includes('calcaneus') ||
        raw.includes('talus') ||
        raw.includes('cuboid') ||
        raw.includes('cuneiform') ||
        raw.includes('跗骨') ||
        raw.includes('跟骨') ||
        raw.includes('距骨') ||
        raw.includes('立方骨') ||
        raw.includes('楔狀骨') ||
        (
            raw.includes('navicular') &&
            (
                raw.includes('foot') ||
                raw.includes('feet') ||
                raw.includes('lower limbs') ||
                raw.includes('lower limb') ||
                raw.includes('lowerlimbs') ||
                raw.includes('lowerlimb') ||
                raw.includes('下肢') ||
                raw.includes('tarsus') ||
                raw.includes('tarsal') ||
                raw.includes('跗骨') ||
                raw.includes('足') ||
                raw.includes('腳')
            )
        ) ||
        (
            raw.includes('舟狀骨') &&
            (
                raw.includes('navicular') ||
                raw.includes('foot') ||
                raw.includes('feet') ||
                raw.includes('lower limbs') ||
                raw.includes('lower limb') ||
                raw.includes('lowerlimbs') ||
                raw.includes('lowerlimb') ||
                raw.includes('下肢') ||
                raw.includes('tarsus') ||
                raw.includes('tarsal') ||
                raw.includes('跗骨') ||
                raw.includes('足') ||
                raw.includes('腳')
            )
        )
    ) {
        return 'foot';
    }


    /**
     * 指骨要先分出去。
     * 掌骨 metacarpal 還是 hand；
     * 指骨 phalanx / phalanges / finger / thumb 改走 finger。
     */
    if (
        raw.includes('phalanx') ||
        raw.includes('phalanges') ||
        raw.includes('finger') ||
        raw.includes('fingers') ||
        raw.includes('thumb') ||
        raw.includes('指骨') ||
        raw.includes('手指')
    ) {
        return 'finger';
    }

    /**
     * hand 一定要放在 wrist 前面。
     * 因為 metacarpal / metacarpals 裡面包含 carpal，
     * 如果先判斷 wrist，掌骨會被誤判成手腕。
     */
    if (
        raw.includes('hand') ||
        raw.includes('metacarpal') ||
        raw.includes('metacarpals') ||
        raw.includes('掌骨') ||
        raw.includes('手掌') ||
        raw.includes('手')
    ) {
        return 'hand';
    }



    if (
        raw.includes('wrist') ||
        raw.includes('carpal') ||
        raw.includes('carpals') ||
        raw.includes('scaphoid') ||
        raw.includes('lunate') ||
        raw.includes('triquetrum') ||
        raw.includes('pisiform') ||
        raw.includes('trapezium') ||
        raw.includes('trapezoid') ||
        raw.includes('capitate') ||
        raw.includes('hamate') ||
        raw.includes('腕') ||
        raw.includes('腕骨') ||
        raw.includes('月狀骨') ||
        raw.includes('三角骨') ||
        raw.includes('豆狀骨') ||
        raw.includes('大多角骨') ||
        raw.includes('小多角骨') ||
        raw.includes('頭狀骨') ||
        raw.includes('鉤狀骨')
    ) {
        return 'wrist';
    }

    if (
        raw.includes('pelvis') ||
        raw.includes('hip bone') ||
        raw.includes('hipbone') ||
        raw.includes('hip') ||
        raw.includes('ilium') ||
        raw.includes('ischium') ||
        raw.includes('pubis') ||
        raw.includes('骨盆') ||
        raw.includes('髖骨') ||
        raw.includes('髂骨') ||
        raw.includes('坐骨') ||
        raw.includes('恥骨')
    ) {
        return 'pelvis';
    }

    if (
        raw.includes('femur') ||
        raw.includes('femora') ||
        raw.includes('thigh') ||
        raw.includes('股骨') ||
        raw.includes('大腿')
    ) {
        return 'thigh';
    }

    if (
        raw.includes('patella') ||
        raw.includes('patellae') ||
        raw.includes('knee') ||
        raw.includes('髕骨') ||
        raw.includes('膝')
    ) {
        return 'knee';
    }

    if (
        raw.includes('tibia') ||
        raw.includes('tibiae') ||
        raw.includes('fibula') ||
        raw.includes('fibulae') ||
        raw.includes('lower leg') ||
        raw.includes('小腿') ||
        raw.includes('脛骨') ||
        raw.includes('腓骨')
    ) {
        return 'lowerLeg';
    }



    if (
        raw.includes('foot') ||
        raw.includes('feet') ||
        raw.includes('lower limbs') ||
        raw.includes('lower limb') ||
        raw.includes('lowerlimbs') ||
        raw.includes('lowerlimb') ||
        raw.includes('下肢') ||
        raw.includes('足') ||
        raw.includes('腳') ||
        raw.includes('tarsus') ||
        raw.includes('tarsal') ||
        raw.includes('calcaneus') ||
        raw.includes('talus') ||
        raw.includes('cuboid') ||
        raw.includes('cuneiform') ||
        raw.includes('跗骨') ||
        raw.includes('蹠骨') ||
        raw.includes('跟骨') ||
        raw.includes('距骨') ||
        raw.includes('立方骨') ||
        raw.includes('楔狀骨') ||
        (
            raw.includes('navicular') &&
            (
                raw.includes('foot') ||
                raw.includes('feet') ||
                raw.includes('lower limbs') ||
                raw.includes('lower limb') ||
                raw.includes('lowerlimbs') ||
                raw.includes('lowerlimb') ||
                raw.includes('下肢') ||
                raw.includes('tarsus') ||
                raw.includes('tarsal') ||
                raw.includes('跗骨') ||
                raw.includes('足') ||
                raw.includes('腳')
            )
        ) ||
        (
            raw.includes('舟狀骨') &&
            (
                raw.includes('navicular') ||
                raw.includes('foot') ||
                raw.includes('feet') ||
                raw.includes('lower limbs') ||
                raw.includes('lower limb') ||
                raw.includes('lowerlimbs') ||
                raw.includes('lowerlimb') ||
                raw.includes('下肢') ||
                raw.includes('tarsus') ||
                raw.includes('tarsal') ||
                raw.includes('跗骨') ||
                raw.includes('足') ||
                raw.includes('腳')
            )
        )
    ) {
        return 'foot';
    }

    return '';
}

function detectSide(name?: string | null): SideMode {
    if (!name) return 'both';

    const raw = name.toLowerCase();

    const hasLeft =
        raw.includes('左') ||
        raw.includes('left') ||
        raw.includes('.l') ||
        raw.includes('_l') ||
        raw.includes('-l') ||
        raw.includes(' l ') ||
        raw.startsWith('l:') ||
        raw.includes('| l:');

    const hasRight =
        raw.includes('右') ||
        raw.includes('right') ||
        raw.includes('.r') ||
        raw.includes('_r') ||
        raw.includes('-r') ||
        raw.includes(' r ') ||
        raw.startsWith('r:') ||
        raw.includes('| r:');

    if (hasLeft && !hasRight) return 'left';
    if (hasRight && !hasLeft) return 'right';
    return 'both';
}

const bone2DMap: Record<string, Bone2DTarget> = {
    head: {
        labelZh: '頭部',
        labelEn: 'Head',
        defaultView: 'front',
        //frontSingle: [`${HIGHLIGHT_DIR}/front_head.png`],
        //backSingle: [`${HIGHLIGHT_DIR}/back_head.png`],
        frontDot: { x: 50, y: 8 },
        backDot: { x: 50, y: 8 },
    },

    middleEar: {
        labelZh: '中耳',
        labelEn: 'Middle ear',
        defaultView: 'front',

        // 正面圖用側邊位置表示中耳，不放在頭顱中心。
        frontDotPair: {
            left: { x: 54, y: 10 },
            right: { x: 46, y: 10 },
        },
    },


    hyoid: {
        labelZh: '舌骨',
        labelEn: 'Hyoid bone',
        defaultView: 'front',

        // 舌骨在下巴下方、頸部上方，只給正面。
        frontDot: { x: 50.5, y: 15.5 },
    },

    clavicle: {
        labelZh: '鎖骨',
        labelEn: 'Clavicle',
        defaultView: 'front',
        /*frontPair: {
          left: `${HIGHLIGHT_DIR}/front_clavicle_left.png`,
          right: `${HIGHLIGHT_DIR}/front_clavicle_right.png`,
        },*/
        frontDotPair: {
            left: { x: 57, y: 19 },
            right: { x: 46, y: 19 },
        },
    },

    scapula: {
        labelZh: '肩胛骨',
        labelEn: 'Scapula',
        defaultView: 'back',
        /*backPair: {
          left: `${HIGHLIGHT_DIR}/back_scapula_left.png`,
          right: `${HIGHLIGHT_DIR}/back_scapula_right.png`,
        },*/
        backDotPair: {
            left: { x: 42, y: 25 },
            right: { x: 57, y: 25 },
        },
    },

    sternum: {
        labelZh: '胸骨',
        labelEn: 'Sternum',
        defaultView: 'front',
        //frontSingle: [`${HIGHLIGHT_DIR}/front_sternum.png`],
        frontDot: { x: 50.5, y: 25.5 },
    },

    upperRibs: {
        labelZh: '上位肋骨',
        labelEn: 'Upper ribs',
        defaultView: 'front',

        // Rib 1-2：鎖骨下方、上胸兩側。
        // 正面：2D 人的左側 = 畫面右側；人的右側 = 畫面左側。
        frontDotPair: {
            left: { x: 56, y: 22 },
            right: { x: 46, y: 22 },
        },
    },

    midRibs: {
        labelZh: '中位肋骨',
        labelEn: 'Middle ribs',
        defaultView: 'front',

        // Rib 3-7：胸腔中段。
        frontDotPair: {
            left: { x: 56, y: 24 },
            right: { x: 46, y: 24 },
        },
    },

    lowerRibs: {
        labelZh: '下位肋骨',
        labelEn: 'Lower ribs',
        defaultView: 'front',

        // Rib 8-12：肋骨下緣，接近上腹兩側。
        frontDotPair: {
            left: { x: 56, y: 30 },
            right: { x: 46, y: 30 },
        },
    },

    cervicalSpine: {
        labelZh: '頸椎',
        labelEn: 'Cervical spine',
        defaultView: 'back',
        backDot: { x: 49.5, y: 16 },
    },

    thoracicSpine: {
        labelZh: '胸椎',
        labelEn: 'Thoracic spine',
        defaultView: 'back',
        backDot: { x: 49.5, y: 24 },
    },

    lumbarSpine: {
        labelZh: '腰椎',
        labelEn: 'Lumbar spine',
        defaultView: 'back',
        backDot: { x: 49.5, y: 38 },
    },

    sacrococcyx: {
        labelZh: '薦尾椎',
        labelEn: 'Sacrum / Coccyx',
        defaultView: 'back',
        backDot: { x: 49.5, y: 50 },
    },

    upperArm: {
        labelZh: '上臂',
        labelEn: 'Upper arm',
        defaultView: 'front',
        /*frontPair: {
          left: `${HIGHLIGHT_DIR}/front_upperArm_left.png`,
          right: `${HIGHLIGHT_DIR}/front_upperArm_right.png`,
        },
        backPair: {
          left: `${HIGHLIGHT_DIR}/back_upperArm_left.png`,
          right: `${HIGHLIGHT_DIR}/back_upperArm_right.png`,
        },*/
        frontDotPair: {
            left: { x: 61, y: 31 },
            right: { x: 39, y: 31 },
        },
        backDotPair: {
            left: { x: 39, y: 31 },
            right: { x: 61, y: 31 },
        },
    },

    forearm: {
        labelZh: '前臂',
        labelEn: 'Forearm',
        defaultView: 'front',
        /*frontPair: {
          left: `${HIGHLIGHT_DIR}/front_forearm_left.png`,
          right: `${HIGHLIGHT_DIR}/front_forearm_right.png`,
        },*/
        /*backPair: {
          left: `${HIGHLIGHT_DIR}/back_forearm_left.png`,
          right: `${HIGHLIGHT_DIR}/back_forearm_right.png`,
        },*/
        frontDotPair: {
            left: { x: 64, y: 40 },
            right: { x: 37, y: 40 },
        },
        backDotPair: {
            left: { x: 36, y: 40 },
            right: { x: 63, y: 40 },
        },
    },

    wrist: {
        labelZh: '手腕',
        labelEn: 'Wrist',
        defaultView: 'front',
        /*frontPair: {
          left: `${HIGHLIGHT_DIR}/front_wrist_left.png`,
          right: `${HIGHLIGHT_DIR}/front_wrist_right.png`,
        },
        backPair: {
          left: `${HIGHLIGHT_DIR}/back_wrist_left.png`,
          right: `${HIGHLIGHT_DIR}/back_wrist_right.png`,
        },*/
        frontDotPair: {
            left: { x: 66, y: 46 },
            right: { x: 34, y: 46 },
        },
        backDotPair: {
            left: { x: 33, y: 46 },
            right: { x: 66, y: 46 },
        },
    },

    hand: {
        labelZh: '手部',
        labelEn: 'Hand',
        defaultView: 'front',
        /*frontPair: {
          left: `${HIGHLIGHT_DIR}/front_hand_left.png`,
          right: `${HIGHLIGHT_DIR}/front_hand_right.png`,
        },
        backPair: {
          left: `${HIGHLIGHT_DIR}/back_hand_left.png`,
          right: `${HIGHLIGHT_DIR}/back_hand_right.png`,
        },*/
        frontDotPair: {
            left: { x: 69, y: 51 },
            right: { x: 32, y: 51 },
        },
        backDotPair: {
            left: { x: 32, y: 51 },
            right: { x: 69, y: 51 },
        },
    },

    finger: {
        labelZh: '手指',
        labelEn: 'Fingers',
        defaultView: 'front',
        /* 指骨比掌骨更靠手指末端。
           原本 hand 座標不動，只新增 finger 獨立座標。 */
        frontDotPair: {
            left: { x: 71, y: 56 },
            right: { x: 30, y: 56 },
        },
        backDotPair: {
            left: { x: 30, y: 56 },
            right: { x: 71, y: 56 },
        },
    },

    pelvis: {
        labelZh: '骨盆',
        labelEn: 'Pelvis',
        defaultView: 'front',
        //frontSingle: [`${HIGHLIGHT_DIR}/front_pelvis.png`],
        //backSingle: [`${HIGHLIGHT_DIR}/back_pelvis.png`],
        frontDotPair: {
            left: { x: 57, y: 47 },
            right: { x: 43, y: 47 },
        },
        backDotPair: {
            left: { x: 44, y: 47 },
            right: { x: 54, y: 47 },
        },
    },

    thigh: {
        labelZh: '大腿',
        labelEn: 'Thigh',
        defaultView: 'front',
        /*frontPair: {
          left: `${HIGHLIGHT_DIR}/front_thigh_left.png`,
          right: `${HIGHLIGHT_DIR}/front_thigh_right.png`,
        },
        backPair: {
          left: `${HIGHLIGHT_DIR}/back_thigh_left.png`,
          right: `${HIGHLIGHT_DIR}/back_thigh_right.png`,
        },*/
        frontDotPair: {
            left: { x: 57, y: 60 },
            right: { x: 44, y: 60 },
        },
        backDotPair: {
            left: { x: 43, y: 60 },
            right: { x: 56, y: 60 },
        },
    },

    knee: {
        labelZh: '膝部',
        labelEn: 'Knee',
        defaultView: 'front',
        /*frontPair: {
          left: `${HIGHLIGHT_DIR}/front_knee_left.png`,
          right: `${HIGHLIGHT_DIR}/front_knee_right.png`,
        },
        backPair: {
          left: `${HIGHLIGHT_DIR}/back_knee_left.png`,
          right: `${HIGHLIGHT_DIR}/back_knee_right.png`,
        },*/
        frontDotPair: {
            left: { x: 57, y: 71 },
            right: { x: 44, y: 71 },
        },
        /*backDotPair: {
          left: { x: 42, y: 71 },
          right: { x: 56, y: 71 },
        },*/
    },

    lowerLeg: {
        labelZh: '小腿',
        labelEn: 'Lower leg',
        defaultView: 'front',
        /*frontPair: {
          left: `${HIGHLIGHT_DIR}/front_lowerLeg_left.png`,
          right: `${HIGHLIGHT_DIR}/front_lowerLeg_right.png`,
        },
        backPair: {
          left: `${HIGHLIGHT_DIR}/back_lowerLeg_left.png`,
          right: `${HIGHLIGHT_DIR}/back_lowerLeg_right.png`,
        },*/
        frontDotPair: {
            left: { x: 58, y: 81 },
            right: { x: 41, y: 81 },
        },
        backDotPair: {
            left: { x: 42, y: 81 },
            right: { x: 57, y: 81 },
        },
    },

    foot: {
        labelZh: '足部',
        labelEn: 'Foot',
        defaultView: 'front',
        /*frontPair: {
          left: `${HIGHLIGHT_DIR}/front_foot_left.png`,
          right: `${HIGHLIGHT_DIR}/front_foot_right.png`,
        },
        backPair: {
          left: `${HIGHLIGHT_DIR}/back_foot_left.png`,
          right: `${HIGHLIGHT_DIR}/back_foot_right.png`,
        },*/
        frontDotPair: {
            left: { x: 58, y: 90 },
            right: { x: 44, y: 90 },
        },
        backDotPair: {
            left: { x: 42, y: 95 },
            right: { x: 56, y: 95 },
        },
    },

    midFoot: {
        labelZh: '足掌',
        labelEn: 'Midfoot',
        defaultView: 'front',

        frontDotPair: {
            left: { x: 58, y: 94 },
            right: { x: 44, y: 94 },
        },


    },

    toe: {
        labelZh: '腳趾',
        labelEn: 'Toes',
        defaultView: 'front',
        /* 腳趾比 foot 更靠足部末端。
           原本 foot 座標不動，只新增 toe 獨立座標。 */
        frontDotPair: {
            left: { x: 60, y: 97 },
            right: { x: 42.5, y: 97 },
        },

    },
};

/*function resolvePair(pair: SidePair | undefined, side: SideMode) {
  if (!pair) return [];
  if (side === 'left') return [pair.left];
  if (side === 'right') return [pair.right];
  return [pair.left, pair.right];
}*/

/*function getOverlayPaths(
  target: Bone2DTarget | null,
  view: ViewMode,
  side: SideMode
) {
  if (!target) return [];

  if (view === 'front') {
    if (target.frontSingle?.length) return target.frontSingle;
    if (target.frontPair) return resolvePair(target.frontPair, side);
    return [];
  }

  if (target.backSingle?.length) return target.backSingle;
  if (target.backPair) return resolvePair(target.backPair, side);
  return [];
}*/

function resolveDotPair(pair: DotPair | undefined, side: SideMode) {
    if (!pair) return [];
    if (side === 'left') return [pair.left];
    if (side === 'right') return [pair.right];
    return [pair.left, pair.right];
}

function getDotPositions(
    target: Bone2DTarget | null,
    view: ViewMode,
    side: SideMode
): DotPosition[] {
    if (!target) return [];

    if (view === 'front') {
        if (target.frontDot) return [target.frontDot];
        if (target.frontDotPair) return resolveDotPair(target.frontDotPair, side);
        return [];
    }

    if (target.backDot) return [target.backDot];
    if (target.backDotPair) return resolveDotPair(target.backDotPair, side);
    return [];
}

function hasView(target: Bone2DTarget | null, view: ViewMode) {
    if (!target) return true;

    if (view === 'front') {
        return Boolean(target.frontDot || target.frontDotPair);
    }

    return Boolean(target.backDot || target.backDotPair);
}

export default function Bone2DPanel({
    selectedBoneName,
    onRegionClick,
    locale,
    viewControls,
    onViewChange,
}: Props) {

    const isEn = locale === 'en-US';
    const boneKey = useMemo(
        () => normalizeBoneKey(selectedBoneName),
        [selectedBoneName]
    );

    const side = useMemo(() => detectSide(selectedBoneName), [selectedBoneName]);

    const target = boneKey ? bone2DMap[boneKey] ?? null : null;

    const [view, setView] = useState<ViewMode>('front');

    useEffect(() => {
        if (target) {
            setView(target.defaultView);
        }
    }, [target]);

    const canFront = hasView(target, 'front');
    const canBack = hasView(target, 'back');

    /*const overlayPaths = useMemo(
      () => getOverlayPaths(target, view, side),
      [target, view, side]
    );*/

    const dotPositions = useMemo(
        () => getDotPositions(target, view, side),
        [target, view, side]
    );

    const bodySrc =
        view === 'front' ? '/anatomy/front_body.png' : '/anatomy/back_body.png';

    const handleRegionClick = (regionKey: Bone2DRegionKey) => {
        console.log('[2D region click]', regionKey);
        onRegionClick?.(regionKey);
    };

    return (
        <aside
            className="
      pointer-events-auto flex max-h-[calc(100dvh-104px)] w-full flex-col
      rounded-[28px] border p-5
    "
            style={{
                background: 'var(--panel-bg)',
                borderColor: 'var(--panel-border)',
                color: 'var(--panel-text)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
            }}
        >
            <div className="mb-3 flex shrink-0 items-start justify-between gap-3 pr-12">
                <div>
                    <div className="flex items-center gap-1.5">
                        <div
                            className="text-lg font-bold"
                            style={{ color: 'var(--panel-text)' }}
                        >
                            {isEn ? 'Body Map' : '人體部位圖'}
                        </div>

                        <div className="relative group">
                            <button
                                type="button"
                                className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold transition"
                                style={{
                                    background:
                                        document.documentElement.classList.contains('dark')
                                            ? 'rgba(14,165,233,0.14)'
                                            : 'rgba(56,189,248,0.10)',

                                    color:
                                        document.documentElement.classList.contains('dark')
                                            ? '#38bdf8'
                                            : '#0284c7',

                                    border:
                                        document.documentElement.classList.contains('dark')
                                            ? '1px solid rgba(56,189,248,0.28)'
                                            : '1px solid rgba(14,165,233,0.18)',

                                    boxShadow:
                                        document.documentElement.classList.contains('dark')
                                            ? '0 0 16px rgba(56,189,248,0.18)'
                                            : '0 4px 12px rgba(14,165,233,0.08)',
                                }}                            >
                                ?
                            </button>

                            <div
                                className="
    pointer-events-none absolute left-1/2 top-8 z-[999]
    w-[118px] -translate-x-1/2 rounded-2xl
    px-3 py-2 text-[10px]
    opacity-0 shadow-xl transition-all duration-200
    group-hover:translate-y-0
    group-hover:opacity-100
  "
                                style={{
                                    background: 'var(--panel-bg)',
                                    border: '1px solid var(--panel-border)',
                                    color: 'var(--panel-text)',
                                    boxShadow: '0 10px 24px rgba(0,0,0,0.16)',
                                    backdropFilter: 'blur(12px)',
                                }}                            >
                                <div
                                    className="mb-1 text-center text-[11px] font-bold"
                                    style={{
                                        color: '#38bdf8',
                                    }}
                                >
                                    操作提示
                                </div>

                                <div className="space-y-[2px] text-center leading-5">
                                    <div>左鍵：旋轉</div>
                                    <div>右鍵：平移</div>
                                    <div>滾輪：縮放</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div
                        className="mt-1 text-xs leading-5"
                        style={{ color: 'var(--muted-foreground, rgba(100,116,139,0.9))' }}
                    >
                        {isEn
                            ? 'Automatically highlights the matching body region from the 3D model'
                            : '依 3D 骨頭自動同步高亮對應部位'}
                    </div>
                </div>

                {/*{target && (
                    <div
                        className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
                        style={{
                            background: 'rgba(59,130,246,0.16)',
                            color: '#93c5fd',
                            border: '1px solid rgba(147,197,253,0.25)',
                        }}
                    >
                        {isEn ? target.labelEn : `${target.labelZh} / ${target.labelEn}`}
                    </div>
                )}
            */}
            </div>

            {viewControls ? (
                <div className="mx-3 mb-3 shrink-0 ">
                    {viewControls}
                </div>
            ) : null}

            <div
                className="mx-3 mb-3 grid shrink-0 grid-cols-2 gap-2 rounded-[16px] p-1"
                style={{
                    background: 'rgba(148, 163, 184, 0.14)',
                    border: '1px solid var(--panel-border)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
            >
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                        if (!canFront) return;
                        setView('front');
                        onViewChange?.('front');
                    }} onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && canFront) setView('front');
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-[11px] px-2 py-1.5 text-sm font-bold transition"
                    style={{
                        background:
                            view === 'front'
                                ? 'linear-gradient(135deg, #7dd3fc, #38bdf8)'
                                : 'transparent',
                        color: view === 'front' ? '#ffffff' : 'var(--panel-text)',
                        boxShadow:
                            view === 'front'
                                ? '0 6px 14px rgba(14, 165, 233, 0.18)'
                                : 'none',
                        opacity: !canFront ? 0.4 : 1,
                        cursor: !canFront ? 'not-allowed' : 'pointer',
                        outline: 'none',
                        userSelect: 'none',
                    }}                >
                    <span style={{ fontSize: 15 }}>♙</span>
                    <span>{isEn ? 'Front' : '正面'}</span>
                </div>

                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                        if (!canBack) return;
                        setView('back');
                        onViewChange?.('back');
                    }}
                    onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && canBack) setView('back');
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-[11px] px-2 py-1.5 text-sm font-bold transition"
                    style={{
                        background:
                            view === 'back'
                                ? 'linear-gradient(135deg, #7dd3fc, #38bdf8)'
                                : 'transparent',
                        color: view === 'back' ? '#ffffff' : 'var(--panel-text)',
                        boxShadow:
                            view === 'back'
                                ? '0 6px 14px rgba(14, 165, 233, 0.18)'
                                : 'none',
                        opacity: !canBack ? 0.4 : 1,
                        cursor: !canBack ? 'not-allowed' : 'pointer',
                        outline: 'none',
                        userSelect: 'none',
                    }}
                >
                    <span style={{ fontSize: 15 }}>♙</span>
                    <span>{isEn ? 'Back' : '背面'}</span>
                </div>
            </div>

            <div
                className="mx-3 min-h-0 flex flex-1 flex-col rounded-[26px] border p-2"
                style={{
                    background: 'var(--panel-btn-bg)',
                    borderColor: 'var(--panel-border)',
                }}
            >
                {/*
          重點在這裡：
          1. 不再用固定 620px 大圖硬塞。
          2. 用 panel 剩餘高度 flex-1 自動縮放。
          3. object-contain 確保頭和腳完整出現。
        */}
                <div
                    className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[14px]" style={{
                        background: 'var(--image-panel-bg, rgba(255,255,255,0.96))',
                    }}
                >
                    <style>{`
            @keyframes bone2dPulse {
              0% {
                transform: translate(-50%, -50%) scale(0.82);
                opacity: 0.32;
              }
              50% {
                transform: translate(-50%, -50%) scale(1.12);
                opacity: 0.72;
              }
              100% {
                transform: translate(-50%, -50%) scale(0.82);
                opacity: 0.32;
              }
            }
            @keyframes bone2dRing {
              0% {
                transform: translate(-50%, -50%) scale(0.55);
                opacity: 0.42;
              }
              100% {
                transform: translate(-50%, -50%) scale(2.05);
                opacity: 0;
              }
            }
          `}</style>

                    <img
                        src={bodySrc}
                        alt={view === 'front' ? 'Front body map' : 'Back body map'}
                        className="pointer-events-none select-none object-contain"
                        draggable={false}
                        style={{
                            height: '100%',
                            maxHeight: '100%',
                            width: 'auto',
                            maxWidth: '98%',
                            opacity: 0.96,
                            filter: 'contrast(1.03) saturate(1.02)',
                        }}
                    />

                    {/* 2D 圖點擊區：只做分類導覽，不直接選 206 細項骨頭 */}
                    <div
                        className="absolute inset-0"
                        style={{
                            zIndex: 80,
                            pointerEvents: 'auto',
                        }}
                    >
                        {/* 頭頸部：頭、脖子 */}
                        <div
                            role="button"
                            tabIndex={0}
                            aria-label="展開頭頸部骨頭分類"
                            title="展開頭頸部"
                            onClick={() => handleRegionClick('head-neck')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleRegionClick('head-neck');
                                }
                            }}
                            className="absolute rounded-full"
                            style={{
                                left: '36%',
                                top: '2%',
                                width: '28%',
                                height: '18%',
                                background: 'transparent',
                                cursor: 'pointer',
                                zIndex: 30,
                            }}
                        />

                        {/* 胸背部：胸骨、肋骨中央、胸椎對應區；不要吃到肩膀、手臂、腹部 */}
                        <div
                            role="button"
                            tabIndex={0}
                            aria-label="展開胸背部骨頭分類"
                            title="展開胸背部"
                            onClick={() => handleRegionClick('thorax-back')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleRegionClick('thorax-back');
                                }
                            }}
                            className="absolute rounded-2xl"
                            style={{
                                left: '42%',
                                top: '21%',
                                width: '19%',
                                height: '20%',
                                background: 'transparent',
                                cursor: 'pointer',
                                zIndex: 20,
                            }}
                        />

                        {/* 畫面左側的人體上肢：包含肩膀、肱骨、前臂、手腕、手掌、手指 */}
                        <div
                            role="button"
                            tabIndex={0}
                            aria-label="展開上肢骨頭分類"
                            title="展開上肢"
                            onClick={() => handleRegionClick('upper-limb')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleRegionClick('upper-limb');
                                }
                            }}
                            className="absolute rounded-2xl"
                            style={{
                                left: '13%',
                                top: '18%',
                                width: '28%',
                                height: '48%',
                                background: 'transparent',
                                cursor: 'pointer',
                                zIndex: 35,
                            }}
                        />

                        {/* 畫面右側的人體上肢：包含肩膀、肱骨、前臂、手腕、手掌、手指 */}
                        <div
                            role="button"
                            tabIndex={0}
                            aria-label="展開上肢骨頭分類"
                            title="展開上肢"
                            onClick={() => handleRegionClick('upper-limb')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleRegionClick('upper-limb');
                                }
                            }}
                            className="absolute rounded-2xl"
                            style={{
                                left: '60%',
                                top: '18%',
                                width: '40%',
                                height: '48%',
                                background: 'transparent',
                                cursor: 'pointer',
                                zIndex: 35,
                            }}
                        />

                        {/* 骨盆：只框骨盆/髖部，不吃到左右手腕與大腿太多 */}
                        <div
                            role="button"
                            tabIndex={0}
                            aria-label="展開骨盆骨頭分類"
                            title="展開骨盆"
                            onClick={() => handleRegionClick('pelvis')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleRegionClick('pelvis');
                                }
                            }}
                            className="absolute rounded-2xl"
                            style={{
                                left: '38%',
                                top: '42%',
                                width: '24%',
                                height: '10%',
                                background: 'transparent',
                                cursor: 'pointer',
                                zIndex: 32,
                            }}
                        />

                        {/* 下肢 */}
                        <div
                            role="button"
                            tabIndex={0}
                            aria-label="展開下肢骨頭分類"
                            title="展開下肢"
                            onClick={() => handleRegionClick('lower-limb')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleRegionClick('lower-limb');
                                }
                            }}
                            className="absolute rounded-2xl"
                            style={{
                                left: '35%',
                                top: '53%',
                                width: '33%',
                                height: '45%',
                                background: 'transparent',
                                cursor: 'pointer',
                                zIndex: 30,
                            }}
                        />
                    </div>

                    {/*{overlayPaths.map((src) => (
            <img
              key={`${src}-glow`}
              src={src}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
              draggable={false}
              style={{
                opacity: 0.42,
                mixBlendMode: 'screen',
                filter:
                  'brightness(3.1) saturate(2.2) blur(2px) drop-shadow(0 0 10px rgba(14,165,233,0.45)) drop-shadow(0 0 18px rgba(14,165,233,0.28))',
              }}
            />
          ))}

          {overlayPaths.map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
              draggable={false}
              style={{
                opacity: 0.5,
                mixBlendMode: 'screen',
                filter:
                  'brightness(2.6) saturate(2) contrast(1.12) drop-shadow(0 0 6px rgba(14,165,233,0.4))',
              }}
            />
          ))}*/}

                    {dotPositions.map((dot, index) => (
                        <div
                            key={`${dot.x}-${dot.y}-${index}`}
                            aria-hidden="true"
                            className="pointer-events-none absolute z-20"
                            style={{
                                left: `${dot.x}%`,
                                top: `${dot.y}%`,
                                width: 12,
                                height: 12,
                                borderRadius: 999,
                                background:
                                    'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(56,189,248,0.58) 34%, rgba(37,99,235,0.42) 62%, rgba(37,99,235,0) 72%)',
                                boxShadow:
                                    '0 0 8px rgba(56,189,248,0.5), 0 0 16px rgba(37,99,235,0.32), 0 0 24px rgba(37,99,235,0.22)',
                                animation: 'bone2dPulse 1.05s ease-in-out infinite',
                            }}
                        >
                            <span
                                className="absolute left-1/2 top-1/2 rounded-full border-2 border-sky-300"
                                style={{
                                    width: 0,
                                    height: 0,
                                    animation: 'bone2dRing 1.05s ease-out infinite',
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {target ? (
                <div
                    className="mx-3 mt-3 shrink-0 rounded-2xl border px-4 py-2 text-[10px]"
                    style={{
                        background: 'var(--panel-btn-bg)',
                        borderColor: 'var(--panel-border)',
                        color: 'var(--panel-text)',
                    }}
                >
                    {isEn ? 'Currently highlighted:' : '目前已同步高亮：'}

                    <span
                        className="ml-1 font-medium text-[10px]"
                        style={{ color: 'var(--panel-text)' }}
                    >
                        {isEn ? target.labelEn : target.labelZh}
                    </span>

                    {!isEn && (
                        <>
                            <span className="mx-1 text-slate-400">/</span>
                            <span
                                className="font-medium"
                                style={{
                                    color:
                                        document.documentElement.classList.contains('dark')
                                            ? '#38bdf8'
                                            : '#0b5980',
                                }}
                            >
                                {target.labelEn}
                            </span>
                        </>
                    )}
                </div>
            ) : null}
        </aside>
    );
}