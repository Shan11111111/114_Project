'use client';

import { useEffect, useMemo, useState } from 'react';

type ViewMode = 'front' | 'back';
type SideMode = 'left' | 'right' | 'both';

type RegionKey =
  | 'head'
  | 'clavicle'
  | 'scapula'
  | 'sternum'
  | 'ribs'
  | 'spine'
  | 'pelvis'
  | 'upperArm'
  | 'forearm'
  | 'wrist'
  | 'hand'
  | 'thigh'
  | 'knee'
  | 'lowerLeg'
  | 'foot';

type BoneTarget = {
  view: ViewMode;
  labelZh: string;
  labelEn: string;
  regions: RegionKey[];
  side: SideMode;
};

type Props = {
  selectedBoneName?: string | null;
};

function normalizeText(name?: string | null) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\./g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectSide(raw: string): SideMode {
  const compact = raw.replace(/\s+/g, '');

  const isLeft =
    raw.includes(' left ') ||
    raw.startsWith('left ') ||
    raw.includes('左') ||
    compact.endsWith('l') ||
    compact.includes('claviclel') ||
    compact.includes('scapulal') ||
    compact.includes('scapulael') ||
    compact.includes('humerusl') ||
    compact.includes('radiusl') ||
    compact.includes('ulnal') ||
    compact.includes('metacarpall') ||
    compact.includes('phalangesl') ||
    compact.includes('femurl') ||
    compact.includes('tibial') ||
    compact.includes('fibulal');

  const isRight =
    raw.includes(' right ') ||
    raw.startsWith('right ') ||
    raw.includes('右') ||
    compact.endsWith('r') ||
    compact.includes('clavicler') ||
    compact.includes('scapular') ||
    compact.includes('scapulaer') ||
    compact.includes('humerusr') ||
    compact.includes('radiusr') ||
    compact.includes('ulnar') ||
    compact.includes('metacarpalr') ||
    compact.includes('phalangesr') ||
    compact.includes('femurr') ||
    compact.includes('tibiar') ||
    compact.includes('fibular');

  if (isLeft && !isRight) return 'left';
  if (isRight && !isLeft) return 'right';
  return 'both';
}

function normalizeBoneTarget(name?: string | null): BoneTarget | null {
  if (!name) return null;

  const raw = normalizeText(name);
  const side = detectSide(raw);

  if (
    raw.includes('skull') ||
    raw.includes('cranium') ||
    raw.includes('frontal') ||
    raw.includes('parietal') ||
    raw.includes('occipital') ||
    raw.includes('temporal') ||
    raw.includes('sphenoid') ||
    raw.includes('ethmoid') ||
    raw.includes('zygomatic') ||
    raw.includes('nasal') ||
    raw.includes('maxilla') ||
    raw.includes('mandible') ||
    raw.includes('hyoid') ||
    raw.includes('頭顱') ||
    raw.includes('顱骨') ||
    raw.includes('額骨') ||
    raw.includes('頂骨') ||
    raw.includes('枕骨') ||
    raw.includes('顳骨') ||
    raw.includes('蝶骨') ||
    raw.includes('篩骨') ||
    raw.includes('顴骨') ||
    raw.includes('鼻骨') ||
    raw.includes('上顎') ||
    raw.includes('下顎') ||
    raw.includes('下頜') ||
    raw.includes('舌骨') ||
    raw.includes('聽小骨') ||
    raw.includes('砧骨') ||
    raw.includes('錘骨') ||
    raw.includes('槌骨') ||
    raw.includes('鐙骨') ||
    raw.includes('incus') ||
    raw.includes('malleus') ||
    raw.includes('stapes') ||
    raw.includes('ossicle')
  ) {
    return {
      view: 'front',
      labelZh: '頭顱骨',
      labelEn: 'Skull',
      regions: ['head'],
      side: 'both',
    };
  }

  if (raw.includes('clavicle') || raw.includes('clavicles') || raw.includes('鎖骨')) {
    return {
      view: 'front',
      labelZh: '鎖骨',
      labelEn: 'Clavicle',
      regions: ['clavicle'],
      side,
    };
  }

  if (raw.includes('scapula') || raw.includes('scapulae') || raw.includes('肩胛')) {
    return {
      view: 'back',
      labelZh: '肩胛骨',
      labelEn: 'Scapula',
      regions: ['scapula'],
      side,
    };
  }

  if (raw.includes('sternum') || raw.includes('胸骨')) {
    return {
      view: 'front',
      labelZh: '胸骨',
      labelEn: 'Sternum',
      regions: ['sternum'],
      side: 'both',
    };
  }

  if (raw.includes('rib') || raw.includes('ribs') || raw.includes('肋骨')) {
    return {
      view: 'front',
      labelZh: '肋骨',
      labelEn: 'Ribs',
      regions: ['ribs'],
      side,
    };
  }

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
    return {
      view: 'back',
      labelZh: '脊椎',
      labelEn: 'Spine',
      regions: ['spine'],
      side: 'both',
    };
  }

  if (
    raw.includes('pelvis') ||
    raw.includes('hipbone') ||
    raw.includes('pelvic') ||
    raw.includes('hip') ||
    raw.includes('骨盆') ||
    raw.includes('髖骨')
  ) {
    return {
      view: 'front',
      labelZh: '骨盆',
      labelEn: 'Pelvis',
      regions: ['pelvis'],
      side: 'both',
    };
  }

  if (raw.includes('humerus') || raw.includes('humeri') || raw.includes('肱骨')) {
    return {
      view: 'front',
      labelZh: '肱骨',
      labelEn: 'Humerus',
      regions: ['upperArm'],
      side,
    };
  }

  if (raw.includes('radius') || raw.includes('radii') || raw.includes('橈骨')) {
    return {
      view: 'front',
      labelZh: '橈骨',
      labelEn: 'Radius',
      regions: ['forearm'],
      side,
    };
  }

  if (raw.includes('ulna') || raw.includes('ulnae') || raw.includes('尺骨')) {
    return {
      view: 'front',
      labelZh: '尺骨',
      labelEn: 'Ulna',
      regions: ['forearm'],
      side,
    };
  }

  if (
    raw.includes('scaphoid') ||
    raw.includes('lunate') ||
    raw.includes('triquetrum') ||
    raw.includes('pisiform') ||
    raw.includes('trapezium') ||
    raw.includes('trapezoid') ||
    raw.includes('capitate') ||
    raw.includes('hamate') ||
    raw.includes('carpal') ||
    raw.includes('腕骨')
  ) {
    return {
      view: 'front',
      labelZh: '腕骨',
      labelEn: 'Carpal bones',
      regions: ['wrist'],
      side,
    };
  }

  if (
    raw.includes('metacarpal') ||
    raw.includes('metacarpals') ||
    raw.includes('phalanx') ||
    raw.includes('phalanges') ||
    raw.includes('thumb') ||
    raw.includes('index') ||
    raw.includes('middle') ||
    raw.includes('ring') ||
    raw.includes('little') ||
    raw.includes('hand') ||
    raw.includes('掌骨') ||
    raw.includes('指骨') ||
    raw.includes('手骨')
  ) {
    return {
      view: 'front',
      labelZh: '手骨',
      labelEn: 'Hand bones',
      regions: ['hand'],
      side,
    };
  }

  if (raw.includes('femur') || raw.includes('femora') || raw.includes('股骨')) {
    return {
      view: 'front',
      labelZh: '股骨',
      labelEn: 'Femur',
      regions: ['thigh'],
      side,
    };
  }

  if (raw.includes('patella') || raw.includes('patellae') || raw.includes('髕骨')) {
    return {
      view: 'front',
      labelZh: '髕骨',
      labelEn: 'Patella',
      regions: ['knee'],
      side,
    };
  }

  if (raw.includes('tibia') || raw.includes('tibiae') || raw.includes('脛骨')) {
    return {
      view: 'front',
      labelZh: '脛骨',
      labelEn: 'Tibia',
      regions: ['lowerLeg'],
      side,
    };
  }

  if (raw.includes('fibula') || raw.includes('fibulae') || raw.includes('腓骨')) {
    return {
      view: 'front',
      labelZh: '腓骨',
      labelEn: 'Fibula',
      regions: ['lowerLeg'],
      side,
    };
  }

  if (
    raw.includes('talus') ||
    raw.includes('calcaneus') ||
    raw.includes('navicular') ||
    raw.includes('cuboid') ||
    raw.includes('cuneiform') ||
    raw.includes('metatarsal') ||
    raw.includes('toe') ||
    raw.includes('hallux') ||
    raw.includes('foot') ||
    raw.includes('距骨') ||
    raw.includes('跟骨') ||
    raw.includes('舟狀骨') ||
    raw.includes('立方骨') ||
    raw.includes('楔狀骨') ||
    raw.includes('蹠骨') ||
    raw.includes('趾骨') ||
    raw.includes('足骨')
  ) {
    return {
      view: 'front',
      labelZh: '足骨',
      labelEn: 'Foot bones',
      regions: ['foot'],
      side,
    };
  }

  return null;
}

function isActive(
  region: RegionKey,
  activeRegions: RegionKey[],
  activeSide: SideMode,
  regionSide: SideMode = 'both'
) {
  if (!activeRegions.includes(region)) return false;
  if (activeSide === 'both') return true;
  if (regionSide === 'both') return true;
  return activeSide === regionSide;
}

function clipOpacity(
  region: RegionKey,
  activeRegions: RegionKey[],
  activeSide: SideMode,
  regionSide: SideMode = 'both'
) {
  return isActive(region, activeRegions, activeSide, regionSide) ? 1 : 0;
}

function FrontHighlightImage({
  imageSrc,
  activeRegions,
  side,
}: {
  imageSrc: string;
  activeRegions: RegionKey[];
  side: SideMode;
}) {
  const o = (region: RegionKey, regionSide: SideMode = 'both') =>
    clipOpacity(region, activeRegions, side, regionSide);

  return (
    <svg
      viewBox="0 0 260 430"
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="front-head">
          <ellipse cx="130" cy="60" rx="24" ry="31" />
        </clipPath>

        <clipPath id="front-clavicle-left">
          <path d="M97 120 C107 113 117 113 126 119 C119 123 110 126 100 129 C97 127 96 123 97 120 Z" />
        </clipPath>
        <clipPath id="front-clavicle-right">
          <path d="M163 120 C153 113 143 113 134 119 C141 123 150 126 160 129 C163 127 164 123 163 120 Z" />
        </clipPath>

        <clipPath id="front-sternum">
          <rect x="124" y="124" width="12" height="46" rx="6" />
        </clipPath>

        <clipPath id="front-ribs-left">
          <path d="M88 128 C99 126 111 126 121 123 C122 138 122 155 118 171 C107 175 96 172 88 164 C84 151 84 138 88 128Z" />
        </clipPath>
        <clipPath id="front-ribs-right">
          <path d="M172 128 C161 126 149 126 139 123 C138 138 138 155 142 171 C153 175 164 172 172 164 C176 151 176 138 172 128Z" />
        </clipPath>

        <clipPath id="front-pelvis">
          <path d="M96 214 C108 221 118 224 130 224 C142 224 152 221 164 214 C172 220 176 231 174 244 C166 255 157 262 148 266 C142 262 136 260 130 260 C124 260 118 262 112 266 C103 262 94 255 86 244 C84 231 88 220 96 214Z" />
        </clipPath>

        <clipPath id="front-upper-arm-left">
          <path d="M76 136 C67 145 61 160 60 176 C60 189 65 199 72 205 C79 202 83 197 85 191 C82 173 79 154 76 136Z" />
        </clipPath>
        <clipPath id="front-upper-arm-right">
          <path d="M184 136 C193 145 199 160 200 176 C200 189 195 199 188 205 C181 202 177 197 175 191 C178 173 181 154 184 136Z" />
        </clipPath>

        <clipPath id="front-forearm-left">
          <path d="M71 205 C63 219 57 235 56 252 C57 262 62 269 69 272 C76 265 79 255 79 244 C76 230 74 217 71 205Z" />
        </clipPath>
        <clipPath id="front-forearm-right">
          <path d="M189 205 C197 219 203 235 204 252 C203 262 198 269 191 272 C184 265 181 255 181 244 C184 230 186 217 189 205Z" />
        </clipPath>

        <clipPath id="front-wrist-left">
          <ellipse cx="69" cy="274" rx="8" ry="7" />
        </clipPath>
        <clipPath id="front-wrist-right">
          <ellipse cx="191" cy="274" rx="8" ry="7" />
        </clipPath>

        <clipPath id="front-hand-left">
          <path d="M61 281 C56 289 55 299 59 308 C68 305 75 298 77 288 C73 283 67 281 61 281Z" />
        </clipPath>
        <clipPath id="front-hand-right">
          <path d="M199 281 C204 289 205 299 201 308 C192 305 185 298 183 288 C187 283 193 281 199 281Z" />
        </clipPath>

        <clipPath id="front-thigh-left">
          <path d="M110 265 C103 281 99 300 99 321 C104 327 111 330 119 330 C122 308 123 286 122 265 C118 264 114 264 110 265Z" />
        </clipPath>
        <clipPath id="front-thigh-right">
          <path d="M150 265 C157 281 161 300 161 321 C156 327 149 330 141 330 C138 308 137 286 138 265 C142 264 146 264 150 265Z" />
        </clipPath>

        <clipPath id="front-knee-left">
          <ellipse cx="118" cy="337" rx="11" ry="12" />
        </clipPath>
        <clipPath id="front-knee-right">
          <ellipse cx="142" cy="337" rx="11" ry="12" />
        </clipPath>

        <clipPath id="front-lower-leg-left">
          <path d="M112 349 C108 363 106 382 105 403 C110 407 116 409 121 408 C123 388 123 368 122 349 C118 348 115 348 112 349Z" />
        </clipPath>
        <clipPath id="front-lower-leg-right">
          <path d="M148 349 C152 363 154 382 155 403 C150 407 144 409 139 408 C137 388 137 368 138 349 C142 348 145 348 148 349Z" />
        </clipPath>

        <clipPath id="front-foot-left">
          <path d="M104 405 C95 407 89 412 88 420 C98 421 108 419 117 414 C115 409 111 406 104 405Z" />
        </clipPath>
        <clipPath id="front-foot-right">
          <path d="M156 405 C165 407 171 412 172 420 C162 421 152 419 143 414 C145 409 149 406 156 405Z" />
        </clipPath>
      </defs>

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-head)" opacity={o('head')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-clavicle-left)" opacity={o('clavicle', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-clavicle-right)" opacity={o('clavicle', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-sternum)" opacity={o('sternum')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-ribs-left)" opacity={o('ribs', 'left')} style={{ filter: 'brightness(1.42) saturate(1.2)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-ribs-right)" opacity={o('ribs', 'right')} style={{ filter: 'brightness(1.42) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-pelvis)" opacity={o('pelvis')} style={{ filter: 'brightness(1.42) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-upper-arm-left)" opacity={o('upperArm', 'left')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-upper-arm-right)" opacity={o('upperArm', 'right')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-forearm-left)" opacity={o('forearm', 'left')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-forearm-right)" opacity={o('forearm', 'right')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-wrist-left)" opacity={o('wrist', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-wrist-right)" opacity={o('wrist', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-hand-left)" opacity={o('hand', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-hand-right)" opacity={o('hand', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-thigh-left)" opacity={o('thigh', 'left')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-thigh-right)" opacity={o('thigh', 'right')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-knee-left)" opacity={o('knee', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-knee-right)" opacity={o('knee', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-lower-leg-left)" opacity={o('lowerLeg', 'left')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-lower-leg-right)" opacity={o('lowerLeg', 'right')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-foot-left)" opacity={o('foot', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#front-foot-right)" opacity={o('foot', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
    </svg>
  );
}

function BackHighlightImage({
  imageSrc,
  activeRegions,
  side,
}: {
  imageSrc: string;
  activeRegions: RegionKey[];
  side: SideMode;
}) {
  const o = (region: RegionKey, regionSide: SideMode = 'both') =>
    clipOpacity(region, activeRegions, side, regionSide);

  return (
    <svg
      viewBox="0 0 260 430"
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="back-head">
          <ellipse cx="130" cy="60" rx="24" ry="31" />
        </clipPath>

        <clipPath id="back-scapula-left">
          <path d="M93 126 C104 123 114 131 116 144 C116 156 110 168 99 172 C91 166 87 153 89 140 C90 133 91 129 93 126Z" />
        </clipPath>
        <clipPath id="back-scapula-right">
          <path d="M167 126 C156 123 146 131 144 144 C144 156 150 168 161 172 C169 166 173 153 171 140 C170 133 169 129 167 126Z" />
        </clipPath>

        <clipPath id="back-spine">
          <path d="M125 114 C123 140 124 165 125 191 C125 205 125 220 124 234 L136 234 C135 220 135 205 135 191 C136 165 137 140 135 114Z" />
        </clipPath>

        <clipPath id="back-pelvis">
          <path d="M96 214 C108 221 118 224 130 224 C142 224 152 221 164 214 C172 220 176 231 174 244 C166 255 157 262 148 266 C142 262 136 260 130 260 C124 260 118 262 112 266 C103 262 94 255 86 244 C84 231 88 220 96 214Z" />
        </clipPath>

        <clipPath id="back-upper-arm-left">
          <path d="M76 136 C67 145 61 160 60 176 C60 189 65 199 72 205 C79 202 83 197 85 191 C82 173 79 154 76 136Z" />
        </clipPath>
        <clipPath id="back-upper-arm-right">
          <path d="M184 136 C193 145 199 160 200 176 C200 189 195 199 188 205 C181 202 177 197 175 191 C178 173 181 154 184 136Z" />
        </clipPath>

        <clipPath id="back-forearm-left">
          <path d="M71 205 C63 219 57 235 56 252 C57 262 62 269 69 272 C76 265 79 255 79 244 C76 230 74 217 71 205Z" />
        </clipPath>
        <clipPath id="back-forearm-right">
          <path d="M189 205 C197 219 203 235 204 252 C203 262 198 269 191 272 C184 265 181 255 181 244 C184 230 186 217 189 205Z" />
        </clipPath>

        <clipPath id="back-wrist-left">
          <ellipse cx="69" cy="274" rx="8" ry="7" />
        </clipPath>
        <clipPath id="back-wrist-right">
          <ellipse cx="191" cy="274" rx="8" ry="7" />
        </clipPath>

        <clipPath id="back-hand-left">
          <path d="M61 281 C56 289 55 299 59 308 C68 305 75 298 77 288 C73 283 67 281 61 281Z" />
        </clipPath>
        <clipPath id="back-hand-right">
          <path d="M199 281 C204 289 205 299 201 308 C192 305 185 298 183 288 C187 283 193 281 199 281Z" />
        </clipPath>

        <clipPath id="back-thigh-left">
          <path d="M110 265 C103 281 99 300 99 321 C104 327 111 330 119 330 C122 308 123 286 122 265 C118 264 114 264 110 265Z" />
        </clipPath>
        <clipPath id="back-thigh-right">
          <path d="M150 265 C157 281 161 300 161 321 C156 327 149 330 141 330 C138 308 137 286 138 265 C142 264 146 264 150 265Z" />
        </clipPath>

        <clipPath id="back-knee-left">
          <ellipse cx="118" cy="337" rx="11" ry="12" />
        </clipPath>
        <clipPath id="back-knee-right">
          <ellipse cx="142" cy="337" rx="11" ry="12" />
        </clipPath>

        <clipPath id="back-lower-leg-left">
          <path d="M112 349 C108 363 106 382 105 403 C110 407 116 409 121 408 C123 388 123 368 122 349 C118 348 115 348 112 349Z" />
        </clipPath>
        <clipPath id="back-lower-leg-right">
          <path d="M148 349 C152 363 154 382 155 403 C150 407 144 409 139 408 C137 388 137 368 138 349 C142 348 145 348 148 349Z" />
        </clipPath>

        <clipPath id="back-foot-left">
          <path d="M104 405 C95 407 89 412 88 420 C98 421 108 419 117 414 C115 409 111 406 104 405Z" />
        </clipPath>
        <clipPath id="back-foot-right">
          <path d="M156 405 C165 407 171 412 172 420 C162 421 152 419 143 414 C145 409 149 406 156 405Z" />
        </clipPath>
      </defs>

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-head)" opacity={o('head')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-scapula-left)" opacity={o('scapula', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-scapula-right)" opacity={o('scapula', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-spine)" opacity={o('spine')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-pelvis)" opacity={o('pelvis')} style={{ filter: 'brightness(1.42) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-upper-arm-left)" opacity={o('upperArm', 'left')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-upper-arm-right)" opacity={o('upperArm', 'right')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-forearm-left)" opacity={o('forearm', 'left')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-forearm-right)" opacity={o('forearm', 'right')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-wrist-left)" opacity={o('wrist', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-wrist-right)" opacity={o('wrist', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-hand-left)" opacity={o('hand', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-hand-right)" opacity={o('hand', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-thigh-left)" opacity={o('thigh', 'left')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-thigh-right)" opacity={o('thigh', 'right')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-knee-left)" opacity={o('knee', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-knee-right)" opacity={o('knee', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-lower-leg-left)" opacity={o('lowerLeg', 'left')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-lower-leg-right)" opacity={o('lowerLeg', 'right')} style={{ filter: 'brightness(1.45) saturate(1.2)' }} />

      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-foot-left)" opacity={o('foot', 'left')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
      <image href={imageSrc} x="0" y="0" width="260" height="430" preserveAspectRatio="xMidYMid meet" clipPath="url(#back-foot-right)" opacity={o('foot', 'right')} style={{ filter: 'brightness(1.5) saturate(1.25)' }} />
    </svg>
  );
}

export default function Bone2DPanel({ selectedBoneName }: Props) {
  const target = useMemo(() => normalizeBoneTarget(selectedBoneName), [selectedBoneName]);

  const defaultView: ViewMode = target?.view ?? 'front';
  const [activeView, setActiveView] = useState<ViewMode>(defaultView);

  useEffect(() => {
    setActiveView(defaultView);
  }, [defaultView, selectedBoneName]);

  const imageSrc =
    activeView === 'front'
      ? '/anatomy/front_body.png'
      : '/anatomy/back_body.png';

  const activeRegions = target && target.view === activeView ? target.regions : [];
  const activeSide = target?.side ?? 'both';

  return (
    <aside className="pointer-events-auto w-full rounded-[24px] border border-[#d9e0ea] bg-[#f6f8fc] p-3 shadow-[0_10px_30px_rgba(15,23,42,0.14)]">
      <div className="mb-3 flex items-center justify-center">
        <div className="inline-flex rounded-xl border border-[#d8dee8] bg-[#eef2f7] p-1">
          <button
            type="button"
            onClick={() => setActiveView('front')}
            className="min-w-[72px] rounded-lg px-4 py-2 text-sm font-bold transition"
            style={{
              background:
                activeView === 'front'
                  ? 'linear-gradient(180deg, #4da6ff 0%, #2f80ed 100%)'
                  : 'transparent',
              color: activeView === 'front' ? '#ffffff' : '#334155',
              boxShadow:
                activeView === 'front'
                  ? '0 4px 10px rgba(47,128,237,0.25)'
                  : 'none',
            }}
          >
            正面
          </button>

          <button
            type="button"
            onClick={() => setActiveView('back')}
            className="min-w-[72px] rounded-lg px-4 py-2 text-sm font-bold transition"
            style={{
              background:
                activeView === 'back'
                  ? 'linear-gradient(180deg, #4da6ff 0%, #2f80ed 100%)'
                  : 'transparent',
              color: activeView === 'back' ? '#ffffff' : '#334155',
              boxShadow:
                activeView === 'back'
                  ? '0 4px 10px rgba(47,128,237,0.25)'
                  : 'none',
            }}
          >
            背面
          </button>
        </div>
      </div>

      <div className="rounded-[22px] border border-[#dbe2ec] bg-white px-3 pt-2 pb-3">
        <div className="relative mx-auto h-[470px] w-full max-w-[240px] overflow-visible -translate-y-4">
          <img
            src={imageSrc}
            alt={activeView === 'front' ? '人體正面部位圖' : '人體背面部位圖'}
            className="h-full w-full object-contain select-none"
            draggable={false}
          />

          {activeView === 'front' ? (
            <FrontHighlightImage
              imageSrc={imageSrc}
              activeRegions={activeRegions}
              side={activeSide}
            />
          ) : (
            <BackHighlightImage
              imageSrc={imageSrc}
              activeRegions={activeRegions}
              side={activeSide}
            />
          )}
        </div>
      </div>

      <div className="mt-3 text-center text-xs font-semibold text-slate-500">
        {target ? `${target.labelZh} / ${target.labelEn}` : '尚未選取骨頭'}
      </div>
    </aside>
  );
}