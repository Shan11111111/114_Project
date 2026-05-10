// frontend/app/model/Bone2DPanel.tsx
'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react';

type ViewMode = 'front' | 'back';
type SideMode = 'left' | 'right' | 'both';

type Props = {
    selectedBoneName?: string | null;
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
        raw.includes('舟狀骨') ||
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
        raw.includes('tarsal') ||
        raw.includes('metatarsal') ||
        raw.includes('metatarsals') ||
        raw.includes('calcaneus') ||
        raw.includes('talus') ||
        raw.includes('navicular') ||
        raw.includes('cuboid') ||
        raw.includes('cuneiform') ||
        raw.includes('足') ||
        raw.includes('跗骨') ||
        raw.includes('蹠骨') ||
        raw.includes('跟骨') ||
        raw.includes('距骨') ||
        raw.includes('舟狀骨') ||
        raw.includes('立方骨') ||
        raw.includes('楔狀骨')
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
        frontDot: { x: 51, y: 9 },
        backDot: { x: 49, y: 9 },
    },

    middleEar: {
        labelZh: '中耳',
        labelEn: 'Middle ear',
        defaultView: 'front',

        // 正面圖用側邊位置表示中耳，不放在頭顱中心。
        frontDotPair: {
            left: { x: 54, y: 10 },
            right: { x: 48, y: 10 },
        },
    },


    hyoid: {
        labelZh: '舌骨',
        labelEn: 'Hyoid bone',
        defaultView: 'front',

        // 舌骨在下巴下方、頸部上方，只給正面。
        frontDot: { x: 51, y: 15.5 },
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
            left: { x: 42, y: 31 },
            right: { x: 58, y: 31 },
        },
    },

    sternum: {
        labelZh: '胸骨',
        labelEn: 'Sternum',
        defaultView: 'front',
        //frontSingle: [`${HIGHLIGHT_DIR}/front_sternum.png`],
        frontDot: { x: 51, y: 25.5 },
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
        backDot: { x: 49, y: 16 },
    },

    thoracicSpine: {
        labelZh: '胸椎',
        labelEn: 'Thoracic spine',
        defaultView: 'back',
        backDot: { x: 49, y: 24 },
    },

    lumbarSpine: {
        labelZh: '腰椎',
        labelEn: 'Lumbar spine',
        defaultView: 'back',
        backDot: { x: 49, y: 38 },
    },

    sacrococcyx: {
        labelZh: '薦尾椎',
        labelEn: 'Sacrum / Coccyx',
        defaultView: 'back',
        backDot: { x: 49, y: 50 },
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
            left: { x: 29, y: 35 },
            right: { x: 71, y: 35 },
        },
        backDotPair: {
            left: { x: 29, y: 38 },
            right: { x: 71, y: 38 },
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
            left: { x: 24, y: 49 },
            right: { x: 76, y: 49 },
        },
        backDotPair: {
            left: { x: 24, y: 52 },
            right: { x: 76, y: 52 },
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
            left: { x: 21, y: 56 },
            right: { x: 79, y: 56 },
        },
        backDotPair: {
            left: { x: 21, y: 59 },
            right: { x: 79, y: 59 },
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
            left: { x: 18, y: 61 },
            right: { x: 82, y: 61 },
        },
        backDotPair: {
            left: { x: 18, y: 64 },
            right: { x: 82, y: 64 },
        },
    },

    finger: {
        labelZh: '手指',
        labelEn: 'Fingers',
        defaultView: 'front',
        /* 指骨比掌骨更靠手指末端。
           原本 hand 座標不動，只新增 finger 獨立座標。 */
        frontDotPair: {
            left: { x: 30, y: 56 },
            right: { x: 73, y: 56 },
        },
        backDotPair: {
            left: { x: 28, y: 56 },
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
            right: { x: 45, y: 47 },
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
            right: { x: 55, y: 60 },
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
            left: { x: 58, y: 71 },
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
            right: { x: 44, y: 81 },
        },
        backDotPair: {
            left: { x: 42, y: 81 },
            right: { x: 56, y: 81 },
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

export default function Bone2DPanel({ selectedBoneName }: Props) {
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

    return (
        <aside
            className="
        pointer-events-auto flex max-h-[calc(100dvh-104px)] w-full flex-col
        rounded-[28px] border border-slate-200 bg-white p-4
        text-slate-900 shadow-[0_16px_40px_rgba(15,23,42,0.12)]
      "
        >
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                <div>
                    <div className="text-lg font-bold text-slate-800">人體部位圖</div>
                    <div className="text-xs leading-5 text-slate-500">
                        依 3D 骨頭自動同步高亮對應部位
                    </div>
                </div>

                {target && (
                    <div className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                        {target.labelZh} / {target.labelEn}
                    </div>
                )}
            </div>

            <div className="mb-3 grid shrink-0 grid-cols-2 rounded-2xl bg-slate-100 p-1">
                <button
                    type="button"
                    onClick={() => canFront && setView('front')}
                    disabled={!canFront}
                    className={[
                        'rounded-xl px-4 py-2 text-sm font-semibold transition',
                        view === 'front'
                            ? 'bg-blue-500 text-white shadow'
                            : 'bg-transparent text-slate-600 hover:bg-white',
                        !canFront ? 'cursor-not-allowed opacity-40' : '',
                    ].join(' ')}
                >
                    正面
                </button>

                <button
                    type="button"
                    onClick={() => canBack && setView('back')}
                    disabled={!canBack}
                    className={[
                        'rounded-xl px-4 py-2 text-sm font-semibold transition',
                        view === 'back'
                            ? 'bg-blue-500 text-white shadow'
                            : 'bg-transparent text-slate-600 hover:bg-white',
                        !canBack ? 'cursor-not-allowed opacity-40' : '',
                    ].join(' ')}
                >
                    背面
                </button>
            </div>

            <div className="min-h-0 flex-1 rounded-[26px] border border-slate-200 bg-slate-50 p-3">
                {/*
          重點在這裡：
          1. 不再用固定 620px 大圖硬塞。
          2. 用 panel 剩餘高度 flex-1 自動縮放。
          3. object-contain 確保頭和腳完整出現。
        */}
                <div className="relative h-full min-h-[300px] w-full overflow-hidden">
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
                        className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                        draggable={false}
                    />

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
                                width: 20,
                                height: 20,
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
                                    width: 34,
                                    height: 34,
                                    animation: 'bone2dRing 1.05s ease-out infinite',
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div className="mt-3 shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {target ? (
                    <>
                        目前已同步高亮：
                        <span className="ml-1 font-semibold text-slate-800">
                            {target.labelZh}
                        </span>
                        <span className="mx-1 text-slate-400">/</span>
                        <span className="font-medium text-blue-700">{target.labelEn}</span>
                    </>
                ) : (
                    <>尚未建立此骨頭的 2D 對應高亮。</>
                )}
            </div>
        </aside>
    );
}