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
    raw.includes('下頜') ||
    raw.includes('舌骨')
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
  if (raw.includes('rib') || raw.includes('肋')) return 'ribs';

  if (
    raw.includes('vertebra') ||
    raw.includes('spine') ||
    raw.includes('cervical') ||
    raw.includes('thoracic') ||
    raw.includes('lumbar') ||
    raw.includes('sacrum') ||
    raw.includes('coccyx') ||
    raw.includes('脊椎') ||
    raw.includes('頸椎') ||
    raw.includes('胸椎') ||
    raw.includes('腰椎') ||
    raw.includes('薦骨') ||
    raw.includes('尾骨') ||
    /^c[1-7]$/i.test(raw.replace(/\s/g, '')) ||
    /^t([1-9]|1[0-2])$/i.test(raw.replace(/\s/g, '')) ||
    /^l[1-5]$/i.test(raw.replace(/\s/g, ''))
  ) {
    return 'spine';
  }

  if (
    raw.includes('humerus') ||
    raw.includes('upper arm') ||
    raw.includes('上臂') ||
    raw.includes('肱骨')
  ) {
    return 'upperArm';
  }

  if (
    raw.includes('radius') ||
    raw.includes('ulna') ||
    raw.includes('forearm') ||
    raw.includes('前臂') ||
    raw.includes('橈骨') ||
    raw.includes('尺骨')
  ) {
    return 'forearm';
  }

  if (
    raw.includes('wrist') ||
    raw.includes('carpal') ||
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
    raw.includes('hand') ||
    raw.includes('metacarpal') ||
    raw.includes('phalanx') ||
    raw.includes('phalanges') ||
    raw.includes('finger') ||
    raw.includes('thumb') ||
    raw.includes('掌骨') ||
    raw.includes('指骨') ||
    raw.includes('手')
  ) {
    return 'hand';
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
    raw.includes('thigh') ||
    raw.includes('股骨') ||
    raw.includes('大腿')
  ) {
    return 'thigh';
  }

  if (
    raw.includes('patella') ||
    raw.includes('knee') ||
    raw.includes('髕骨') ||
    raw.includes('膝')
  ) {
    return 'knee';
  }

  if (
    raw.includes('tibia') ||
    raw.includes('fibula') ||
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
    raw.includes('calcaneus') ||
    raw.includes('talus') ||
    raw.includes('navicular') ||
    raw.includes('cuboid') ||
    raw.includes('cuneiform') ||
    raw.includes('toe') ||
    raw.includes('hallux') ||
    raw.includes('足') ||
    raw.includes('跗骨') ||
    raw.includes('蹠骨') ||
    raw.includes('趾骨') ||
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
    frontDot: { x: 50, y: 9 },
    backDot: { x: 50, y: 9 },
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
    frontDot: { x: 50, y: 31 },
  },

  ribs: {
    labelZh: '肋骨',
    labelEn: 'Ribs',
    defaultView: 'front',
    /*frontPair: {
      left: `${HIGHLIGHT_DIR}/front_ribs_left.png`,
      right: `${HIGHLIGHT_DIR}/front_ribs_right.png`,
    },*/
    frontDotPair: {
      left: { x: 43, y: 33 },
      right: { x: 57, y: 33 },
    },
  },

  spine: {
    labelZh: '脊椎',
    labelEn: 'Spine',
    defaultView: 'back',
    //backSingle: [`${HIGHLIGHT_DIR}/back_spine.png`],
    backDot: { x: 50, y: 36 },
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

  pelvis: {
    labelZh: '骨盆',
    labelEn: 'Pelvis',
    defaultView: 'front',
    //frontSingle: [`${HIGHLIGHT_DIR}/front_pelvis.png`],
    //backSingle: [`${HIGHLIGHT_DIR}/back_pelvis.png`],
    frontDot: { x: 50, y: 52 },
    backDot: { x: 50, y: 52 },
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
      left: { x: 43, y: 67 },
      right: { x: 57, y: 67 },
    },
    backDotPair: {
      left: { x: 43, y: 70 },
      right: { x: 57, y: 70 },
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
      left: { x: 42, y: 77 },
      right: { x: 58, y: 77 },
    },
    backDotPair: {
      left: { x: 42, y: 80 },
      right: { x: 58, y: 80 },
    },
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
      left: { x: 42, y: 87 },
      right: { x: 58, y: 87 },
    },
    backDotPair: {
      left: { x: 42, y: 90 },
      right: { x: 58, y: 90 },
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
      left: { x: 41, y: 94 },
      right: { x: 59, y: 94 },
    },
    backDotPair: {
      left: { x: 41, y: 97 },
      right: { x: 59, y: 97 },
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
