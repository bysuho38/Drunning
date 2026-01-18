// 템플릿 생성 및 변형 유틸리티

// 두 좌표 간의 거리 계산 (Haversine 공식)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // 지구 반경 (미터)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 경로의 총 길이 계산
function calculatePathLength(coordinates) {
    let totalLength = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
        totalLength += calculateDistance(
            coordinates[i][0], coordinates[i][1],
            coordinates[i+1][0], coordinates[i+1][1]
        );
    }
    return totalLength;
}

// 경로를 목표 길이로 스케일 조정
function scalePathToLength(coordinates, targetLength) {
    if (coordinates.length < 2) return coordinates;
    
    // 현재 경로 길이 계산
    const currentLength = calculatePathLength(coordinates);
    if (currentLength === 0) return coordinates;
    
    // 스케일 비율 계산
    const scale = targetLength / currentLength;
    
    // 중심점 계산
    let centerLat = 0;
    let centerLon = 0;
    for (const coord of coordinates) {
        centerLat += coord[0];
        centerLon += coord[1];
    }
    centerLat /= coordinates.length;
    centerLon /= coordinates.length;
    
    // 모든 좌표를 중심점 기준으로 스케일 조정
    return coordinates.map(coord => {
        const deltaLat = (coord[0] - centerLat) * scale;
        const deltaLon = (coord[1] - centerLon) * scale;
        return [
            centerLat + deltaLat,
            centerLon + deltaLon
        ];
    });
}

// 템플릿을 균등 간격의 포인트로 리샘플링
function resampleTemplate(template, numPoints = 120) {
    if (template.length < 2) return template;
    
    // 템플릿의 총 길이 계산 (폐쇄형이므로 마지막 포인트에서 첫 포인트로 돌아오는 거리 포함)
    let totalLength = 0;
    const points = [];
    const cumulativeLengths = [0];
    
    // 모든 세그먼트의 길이 계산
    for (let i = 0; i < template.length; i++) {
        const nextIndex = (i + 1) % template.length; // 폐쇄형이므로 마지막은 첫 번째로
        const length = calculateDistance(
            template[i][0], template[i][1],
            template[nextIndex][0], template[nextIndex][1]
        );
        totalLength += length;
        cumulativeLengths.push(totalLength);
        points.push(template[i]);
    }
    
    // 균등 간격으로 리샘플링
    const resampled = [];
    const interval = totalLength / numPoints;
    
    for (let i = 0; i < numPoints; i++) {
        const targetDistance = i * interval;
        
        // targetDistance가 어느 세그먼트에 있는지 찾기
        let segmentIndex = 0;
        for (let j = 0; j < cumulativeLengths.length - 1; j++) {
            if (targetDistance >= cumulativeLengths[j] && targetDistance < cumulativeLengths[j + 1]) {
                segmentIndex = j;
                break;
            }
        }
        
        // 세그먼트 내에서 보간
        const segmentStart = cumulativeLengths[segmentIndex];
        const segmentLength = cumulativeLengths[segmentIndex + 1] - segmentStart;
        const ratio = segmentLength > 0 ? (targetDistance - segmentStart) / segmentLength : 0;
        
        const p1 = points[segmentIndex];
        const p2 = points[(segmentIndex + 1) % points.length];
        
        const lat = p1[0] + (p2[0] - p1[0]) * ratio;
        const lon = p1[1] + (p2[1] - p1[1]) * ratio;
        
        resampled.push([lat, lon]);
    }
    
    // 폐쇄형이므로 첫 포인트를 마지막에 추가
    resampled.push([...resampled[0]]);
    
    return resampled;
}

// 곡률 기반 적응적 리샘플링 (직선 부분은 적게, 곡선 부분은 많이)
function resampleTemplateAdaptive(template, targetNumPoints = 40, curvatureWeight = 2.0) {
    if (template.length < 3) {
        // 포인트가 너무 적으면 기본 함수 사용
        return resampleTemplate(template, targetNumPoints);
    }
    
    // 1단계: 각 세그먼트의 길이와 곡률 계산
    const segments = [];
    const curvatures = [];
    let totalWeightedLength = 0;
    
    // 각 포인트의 곡률 계산
    for (let i = 0; i < template.length; i++) {
        const prevIdx = (i - 1 + template.length) % template.length;
        const currIdx = i;
        const nextIdx = (i + 1) % template.length;
        
        const p1 = template[prevIdx];
        const p2 = template[currIdx];
        const p3 = template[nextIdx];
        
        // 두 벡터 계산
        const v1 = [p2[0] - p1[0], p2[1] - p1[1]];
        const v2 = [p3[0] - p2[0], p3[1] - p2[1]];
        
        const len1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]);
        const len2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);
        
        let curvature = 0;
        if (len1 > 0 && len2 > 0) {
            const n1 = [v1[0] / len1, v1[1] / len1];
            const n2 = [v2[0] / len2, v2[1] / len2];
            const dot = n1[0] * n2[0] + n1[1] * n2[1];
            const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
            curvature = angle / Math.PI; // 0~1
        }
        curvatures.push(curvature);
    }
    
    // 각 세그먼트 정보 계산
    for (let i = 0; i < template.length; i++) {
        const nextIdx = (i + 1) % template.length;
        const segLength = calculateDistance(
            template[i][0], template[i][1],
            template[nextIdx][0], template[nextIdx][1]
        );
        
        // 세그먼트의 곡률 (양 끝 평균)
        const segCurvature = (curvatures[i] + curvatures[nextIdx]) / 2;
        
        // 가중치가 적용된 길이 = 길이 * (1 + 곡률 * 가중치)
        const weightedLength = segLength * (1 + segCurvature * curvatureWeight);
        
        segments.push({
            startIdx: i,
            endIdx: nextIdx,
            length: segLength,
            curvature: segCurvature,
            weightedLength: weightedLength,
            cumulativeWeightedLength: 0 // 나중에 설정
        });
        
        totalWeightedLength += weightedLength;
    }
    
    // 누적 가중치 길이 계산
    let cumulative = 0;
    for (const seg of segments) {
        cumulative += seg.weightedLength;
        seg.cumulativeWeightedLength = cumulative;
    }
    
    // 2단계: 곡률 가중치에 따라 포인트 생성
    const resampled = [];
    const step = totalWeightedLength / targetNumPoints;
    
    for (let i = 0; i < targetNumPoints; i++) {
        const targetWeightedDistance = i * step;
        
        // targetWeightedDistance가 어느 세그먼트에 있는지 찾기
        let segmentIndex = 0;
        for (let j = 0; j < segments.length; j++) {
            const prevCumulative = j === 0 ? 0 : segments[j - 1].cumulativeWeightedLength;
            if (targetWeightedDistance >= prevCumulative && 
                targetWeightedDistance < segments[j].cumulativeWeightedLength) {
                segmentIndex = j;
                break;
            }
        }
        
        const seg = segments[segmentIndex];
        const prevCumulative = segmentIndex === 0 ? 0 : segments[segmentIndex - 1].cumulativeWeightedLength;
        
        // 세그먼트 내에서 비율 계산
        const ratio = seg.weightedLength > 0 
            ? (targetWeightedDistance - prevCumulative) / seg.weightedLength 
            : 0;
        
        // 실제 거리에서의 비율로 변환 (곡률을 고려하지 않은 순수 길이 비율)
        const p1 = template[seg.startIdx];
        const p2 = template[seg.endIdx];
        
        const lat = p1[0] + (p2[0] - p1[0]) * ratio;
        const lon = p1[1] + (p2[1] - p1[1]) * ratio;
        
        resampled.push([lat, lon]);
    }
    
    // 폐쇄형이므로 첫 포인트를 마지막에 추가
    if (resampled.length > 0) {
        resampled.push([...resampled[0]]);
    }
    
    return resampled;
}

// START_POINT 기준으로 템플릿 정렬 (평행이동)
function alignTemplateToStartPoint(template, startPoint) {
    // 템플릿의 첫 포인트를 startPoint로 평행이동
    const offsetLat = startPoint.lat - template[0][0];
    const offsetLon = startPoint.lon - template[0][1];
    
    return template.map(point => [
        point[0] + offsetLat,
        point[1] + offsetLon
    ]);
}

// 템플릿 재정렬 (startIdx부터 시작하도록)
function reorderTemplate(template, startIdx) {
    const numPoints = template.length - 1; // 마지막은 첫 포인트와 동일
    const reordered = [];
    
    for (let i = 0; i < numPoints; i++) {
        const idx = (startIdx + i) % numPoints;
        reordered.push(template[idx]);
    }
    reordered.push(reordered[0]); // 폐쇄형
    
    return reordered;
}

// 템플릿 회전 (중심점 기준)
function rotateTemplate(template, centerLat, centerLon, angleDeg) {
    const angleRad = angleDeg * Math.PI / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    
    return template.map(([lat, lon]) => {
        const dLat = lat - centerLat;
        const dLon = lon - centerLon;
        return [
            centerLat + dLat * cos - dLon * sin,
            centerLon + dLat * sin + dLon * cos
        ];
    });
}

// 좌우반전 (중심점 기준)
function flipTemplateHorizontal(template, centerLat, centerLon, flipH) {
    return template.map(([lat, lon]) => [
        lat,
        centerLon + (lon - centerLon) * flipH
    ]);
}

// 템플릿의 해시값 계산 (중복 체크용)
function getTemplateHash(template) {
    if (template.length < 2) return '';
    
    // 정규화: 첫 포인트를 원점으로
    const normalized = template.map(([lat, lon], idx) => {
        if (idx === 0) return [0, 0];
        return [lat - template[0][0], lon - template[0][1]];
    });
    
    // 첫 세그먼트 각도를 0도로 정규화
    if (normalized.length >= 2) {
        const firstSegment = normalized[1];
        const angle = Math.atan2(firstSegment[1], firstSegment[0]);
        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);
        
        const rotated = normalized.map(([lat, lon]) => [
            lat * cos - lon * sin,
            lat * sin + lon * cos
        ]);
        
        return rotated.map(([lat, lon]) => 
            `${lat.toFixed(6)},${lon.toFixed(6)}`
        ).join('|');
    }
    
    return normalized.map(([lat, lon]) => 
        `${lat.toFixed(6)},${lon.toFixed(6)}`
    ).join('|');
}

// 템플릿 타입별 변형 설정
// 각 템플릿 타입에 대해 필요한 회전 각도와 반전 여부를 정의
const TEMPLATE_VARIATION_CONFIG = {
    'square': {
        rotations: [0, 45],      // 90도 회전시 같음
        flips: [1],          // 반전해도 같으므로 원본만만
        description: '정사각형: 2회전 × 1반전 = 2가지'
    },
    'triangle': {
        rotations: [0, 45, 90, 135, 180, 225, 270, 315],  // 8방향 회전
        flips: [1],             // 반전해도 같음
        description: '정삼각형: 8회전 × 1반전 = 8가지'
    },
    'heart': {
        rotations: [0, 45, 90, 135, 180, 225, 270, 315],  // 8방향 회전
        flips: [1],             // 반전해도 같음
        description: '하트: 8회전 × 1반전 = 8가지'
    },
    'slate': {
        rotations: [0, 45, 90, 135, 180, 225, 270, 315],
        flips: [1],               // 반전 제거 (원본만 사용)
        description: '슬레이트런: 8회전 × 1반전 = 8가지'
    },
    'hanok': {
        rotations: [0, 45, 90, 135, 180, 225, 270, 315],
        flips: [1],              // 한옥런은 좌우 대칭에 가까움
        description: '한옥런: 8회전 × 1반전 = 8가지'
    },
    'book': {
        rotations: [0, 45, 90, 135, 180, 225, 270, 315],
        flips: [1],              // 북런은 좌우 대칭
        description: '북런: 8회전 × 1반전 = 8가지'
    },

    // 새로운 템플릿 추가 시 여기에 설정 추가
    'default': {
        rotations: [0, 45, 90, 135, 180, 225, 270, 315],
        flips: [1],
        description: '기본: 8회전 × 1반전 = 16가지'
    }
};

// 템플릿 변형 생성 (템플릿 타입별 설정에 따라)
// 템플릿의 중심점 기준으로 회전/반전하여 위도/경도 변환 완료
// 중복 제거 없이 설정한 대로 정확히 생성
function generateTemplateVariations(template, centerLat, centerLon, templateType = 'default') {
    console.log(`[템플릿 변형] 요청된 templateType: "${templateType}"`);
    console.log(`[템플릿 변형] 사용 가능한 키:`, Object.keys(TEMPLATE_VARIATION_CONFIG));
    
    const config = TEMPLATE_VARIATION_CONFIG[templateType] || TEMPLATE_VARIATION_CONFIG['default'];
    
    if (!TEMPLATE_VARIATION_CONFIG[templateType]) {
        console.warn(`⚠️ 템플릿 타입 "${templateType}"를 찾을 수 없어 'default' 설정을 사용합니다.`);
    } else {
        console.log(`✅ 템플릿 타입 "${templateType}" 설정을 찾았습니다.`);
    }
    
    const variations = [];
    
    const rotations = config.rotations;
    const flips = config.flips;
    
    // 설정대로 정확히 생성 (중복 제거 없이)
    for (const rotation of rotations) {
        for (const flip of flips) {
            // 회전 적용 (위도/경도 변환)
            const rotated = rotateTemplate(template, centerLat, centerLon, rotation);
            
            // 좌우반전 적용 (위도/경도 변환)
            const flipped = flipTemplateHorizontal(rotated, centerLat, centerLon, flip);
            
            variations.push({
                template: flipped, // 이미 위도/경도 변환 완료된 템플릿
                rotation,
                flip,
                key: `${rotation}_${flip}`
            });
        }
    }
    
    const expectedCount = rotations.length * flips.length;
    console.log(`템플릿 타입 "${templateType}": ${config.description}`);
    console.log(`설정된 변형: ${rotations.length}회전 × ${flips.length}반전 = ${expectedCount}가지`);
    console.log(`실제 생성된 변형: ${variations.length}개`);
    
    if (variations.length !== expectedCount) {
        console.warn(`⚠️ 경고: 생성된 변형 수(${variations.length})가 예상(${expectedCount})과 다릅니다!`);
    }
    
    return variations;
}

// 기본 도형 템플릿 생성 함수들

// 사각형 템플릿 생성
function createSquareTemplate(centerLat, centerLon, targetLength = 5000) {
    // 5km 사각형: 각 변이 약 1.25km
    const sideLength = targetLength / 4; // 미터 단위
    const latOffset = sideLength / 111000; // 1도 위도 ≈ 111km = 111000m
    const lonOffset = sideLength / (111000 * Math.cos(centerLat * Math.PI / 180));
    
    return [
        [centerLat - latOffset, centerLon - lonOffset], // 왼쪽 위
        [centerLat - latOffset, centerLon + lonOffset], // 오른쪽 위
        [centerLat + latOffset, centerLon + lonOffset], // 오른쪽 아래
        [centerLat + latOffset, centerLon - lonOffset], // 왼쪽 아래
        [centerLat - latOffset, centerLon - lonOffset]  // 시작점으로 돌아가기
    ];
}

// 삼각형 템플릿 생성
function createTriangleTemplate(centerLat, centerLon, targetLength = 5000) {
    // 5km 삼각형: 각 변이 약 1.67km
    const sideLength = targetLength / 3; // 미터 단위
    const latOffset = sideLength / 111000; // 1도 위도 ≈ 111km = 111000m
    const lonOffset = sideLength / (111000 * Math.cos(centerLat * Math.PI / 180));
    
    return [
        [centerLat + latOffset * 1.5, centerLon],           // 아래 중앙
        [centerLat - latOffset * 0.75, centerLon - lonOffset * 1.3], // 왼쪽 위
        [centerLat - latOffset * 0.75, centerLon + lonOffset * 1.3], // 오른쪽 위
        [centerLat + latOffset * 1.5, centerLon]            // 시작점으로 돌아가기
    ];
}

// 하트 템플릿 생성
function createHeartTemplate(centerLat, centerLon, targetLength = 5000) {
    // 하트 모양 (매개변수 방정식) - 5km
    const points = [];
    const steps = 200; // 더 부드러운 곡선을 위해 포인트 수 증가
    
    // 하트 방정식의 대략적인 둘레는 약 100-120 단위
    // 하트의 최대 크기(대각선)는 약 50 단위
    // targetLength를 하트의 둘레로 만들기 위한 스케일 계산
    const heartPerimeter = 120; // 하트 방정식의 대략적인 둘레
    const scaleInDegrees = targetLength / 111000; // 미터를 도(degree)로 변환
    const scaleFactor = scaleInDegrees / (heartPerimeter / 2); // 하트의 반지름에 맞춰 스케일 조정
    
    for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * 2 * Math.PI;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));
        // 스케일링 (하트 방정식의 좌표를 실제 지도 좌표로 변환)
        points.push([
            centerLat + y * scaleFactor,
            centerLon + x * scaleFactor
        ]);
    }
    
    return points;
}

// --- 추가 템플릿: 슬레이트런 / 한옥런 / 북런 ---------------------------------

// (로컬 meter 좌표 -> 위경도) 변환 유틸 (x:동+, y:북+)
function localMetersToLatLon(centerLat, centerLon, xMeters, yMeters) {
    const latOffset = yMeters / 111000;
    const lonOffset = xMeters / (111000 * Math.cos(centerLat * Math.PI / 180));
    return [centerLat + latOffset, centerLon + lonOffset];
}

// 1) 전주국제영화제 - 슬레이트런(클래퍼보드 형태)
function createSlateTemplate(centerLat, centerLon, targetLength = 5000) {
    // 클래퍼보드 구조:
    // - 본체: 직사각형 (하단)
    // - 상단 프레임: 본체 위에 사다리꼴 형태 (오른쪽이 더 높음)
    
    // 기본 크기 계산
    const W = targetLength / 4;        // 본체 가로
    const H = targetLength / 5;        // 본체 세로
    const frameHeight = H * 0.33;       // 프레임 높이
    const frameW = W;           // 프레임 가로 (본체랑 같음)
    
    // 본체 좌표 (직사각형)
    const bodyBottom = -H / 2;
    const bodyTop = H / 2;
    const bodyLeft = -W / 2;
    const bodyRight = W / 2;
    
    // 프레임 좌표 (사다리꼴: 본체 위에 위치, 오른쪽이 더 높음)
    const frameBottomLeft = bodyTop + H * 0.05;  // 프레임 하단 (본체와 약간 떨어짐)
    const frameBottomRight = bodyTop + H * 0.15;
    const frameTopLeft = frameBottomLeft + frameHeight;   // 프레임 왼쪽 상단
    const frameTopRight = frameBottomRight + frameHeight;        // 프레임 오른쪽 상단 (더 높음)
    const frameLeft = -frameW / 2;
    const frameRight = frameW / 2;
    
    // 한 붓 그리기 경로: 사용자 지정 순서대로
    // 본체 왼쪽 아래 -> 본체 오른쪽 아래 -> 본체 오른쪽 위 -> 본체 왼쪽 위 -> 
    // 프레임 왼쪽 하단 -> 프레임 오른쪽 하단 -> 프레임 오른쪽 상단 -> 프레임 왼쪽 상단 -> 
    // 프레임 왼쪽 하단 -> 본체 왼쪽 위 -> 본체 왼쪽 아래
    const ptsLocal = [
        [bodyLeft, bodyBottom],        // 1. 본체 왼쪽 아래
        [bodyRight, bodyBottom],       // 2. 본체 오른쪽 아래
        [bodyRight, bodyTop],          // 3. 본체 오른쪽 위
        [bodyLeft, bodyTop],           // 4. 본체 왼쪽 위
        [frameLeft, frameBottomLeft],      // 5. 프레임 왼쪽 하단
        [frameRight, frameBottomRight],     // 6. 프레임 오른쪽 하단
        [frameRight, frameTopRight],   // 7. 프레임 오른쪽 상단 (가장 높음)
        [frameLeft, frameTopLeft],    // 8. 프레임 왼쪽 상단
        [frameLeft, frameBottomLeft],      // 9. 프레임 왼쪽 하단 (다시)
        [bodyLeft, bodyTop],           // 10. 본체 왼쪽 위 (다시)
        [bodyLeft, bodyBottom]         // 11. 본체 왼쪽 아래 (다시, 폐쇄)
    ];

    const result = ptsLocal.map(([x, y]) => localMetersToLatLon(centerLat, centerLon, x, y));
    
    // 폐쇄형이므로 첫 포인트를 마지막에 추가 (총 12개 포인트)
    result.push([...result[0]]);
    
    return result;
}

// 2) 전주한옥마을 - 한옥런(원-스트로크: 외곽 + 내부 기둥 3개를 스퍼 없이)
function createHanokTemplate(centerLat, centerLon, targetLength = 12000) {
    const Wb = targetLength / 3;    // 하단
    const Wt = Wb * 0.6;            // 상단 폭
    const H  = targetLength / 8;    // 높이

    // 외곽 꼭짓점
    const BL = [-Wb / 2, -H / 2];
    const BR = [ Wb / 2, -H / 2];
    const TR = [ Wt / 2,  H / 2];
    const TL = [-Wt / 2,  H / 2];

    // 내부 기둥 3개(상단폭 기준으로 균등)
    const x1 = -Wt * 0.25;
    const x2 =  0;
    const x3 =  Wt * 0.25;

    const P1B = [x1, -H/2], P1T = [x1,  H/2];
    const P2B = [x2, -H/2], P2T = [x2,  H/2];
    const P3B = [x3, -H/2], P3T = [x3,  H/2];

    /**
     * 원-스트로크 설계(폐곡선):
     * 1) 외곽 사다리꼴 한 바퀴(막다른 끝 없음)
     * 2) 이어서 내부 루프: 바닥→기둥→지붕→기둥→바닥… 형태로 진행
     *    (기둥이 가지가 아니라 “루프의 일부”가 되어 스퍼가 생기지 않음)
     *
     * 시각적으로는:
     * - 외곽선이 먼저 잡히고
     * - 내부 기둥 3개가 자연스럽게 포함됨
     */
    const ptsLocal = [
        // (1) 외곽 루프
        BL, BR, TR, TL, BL,

        // (2) 내부 루프(스퍼 없이 닫힘)
        // 바닥선으로 들어가서 기둥/지붕선을 번갈아 타고 다시 바닥으로 복귀
        // BL -> P1B -> P1T -> P2T -> P2B -> P3B -> P3T -> TR -> BR -> BL
        P1B, P1T,
        P2T, P2B,
        P3B, P3T,
        TR, BR, BL
    ];

    // 위경도 변환
    return ptsLocal.map(([x, y]) => localMetersToLatLon(centerLat, centerLon, x, y));
}


// 3) 도서관/문화예술 - 북런(펼친 책 형태)
// 구조: 똑같은 호 4개 (왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래) + 직선 2개
function createBookTemplate(centerLat, centerLon, targetLength = 5000) {
    const W = targetLength / 3.2;   // 책 가로 폭
    const H = targetLength / 4.8;   // 책 세로 높이
    const topHigh = H / 2;          // 상단 높이
    const bottomLow = -H / 2;       // 하단 높이
    const arcDepth = H * 0.3;       // 호의 깊이/높이 (완만하게 조정: 0.4 -> 0.25 -> 0.2)
    
    const steps = 50; // 각 호의 포인트 수 (더 부드러운 곡선을 위해 증가: 40 -> 50)

    // 공통 호 생성 함수: 반원 형태 (0..π)
    // startX: 시작 x 좌표, endX: 끝 x 좌표, baseY: 기준 y 좌표, depth: 호 깊이/높이
    // isConcave: true면 들어감(위쪽), false면 나옴(아래쪽)
    const createArc = (startX, endX, baseY, depth, isConcave) => {
        const arc = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps; // 0..1
            const angle = Math.PI * t; // 0..π
            const x = startX + (endX - startX) * t;
            // 완만한 곡선을 위해 sin^2 사용 (더 부드러운 곡선)
            const curveFactor = Math.sin(angle) * Math.sin(angle); // 0..1, 더 완만한 곡선
            // isConcave=true: baseY에서 depth만큼 아래로 (들어감)
            // isConcave=false: baseY에서 depth만큼 위로 (나옴)
            const y = isConcave ? baseY - depth * curveFactor : baseY + depth * curveFactor;
            arc.push([x, y]);
        }
        return arc;
    };

    // 똑같은 호 4개 생성
    // 1. 왼쪽 위 호: -W/2 -> 0, 위쪽 기준, 중앙으로 들어감
    const leftTopArc = createArc(-W/2, 0, topHigh, arcDepth, true);
    
    // 2. 오른쪽 위 호: 0 -> W/2, 위쪽 기준, 중앙으로 들어감
    const rightTopArc = createArc(0, W/2, topHigh, arcDepth, true);
    
    // 3. 오른쪽 아래 호: W/2 -> 0, 아래쪽 기준, 중앙으로 나옴
    const rightBottomArc = createArc(W/2, 0, bottomLow, arcDepth, true);
    
    // 4. 왼쪽 아래 호: 0 -> -W/2, 아래쪽 기준, 중앙으로 나옴
    const leftBottomArc = createArc(0, -W/2, bottomLow, arcDepth, true);

    // 폴리곤 구성: 시계방향으로 연결
    // 왼쪽 위 호 -> 오른쪽 위 호 -> 오른쪽 직선 -> 오른쪽 아래 호 -> 왼쪽 아래 호 -> 왼쪽 직선
    const ptsLocal = [
        ...leftTopArc,                    // 왼쪽 위 호: [-W/2, topHigh] -> [0, topHigh - arcDepth]
        ...rightTopArc,                   // 오른쪽 위 호: [0, topHigh - arcDepth] -> [W/2, topHigh]
        [W/2, bottomLow],                 // 오른쪽 직선: [W/2, topHigh] -> [W/2, bottomLow]
        ...rightBottomArc,                 // 오른쪽 아래 호: [W/2, bottomLow] -> [0, bottomLow + arcDepth]
        ...leftBottomArc,                  // 왼쪽 아래 호: [0, bottomLow + arcDepth] -> [-W/2, bottomLow]
        [-W/2, topHigh]                   // 왼쪽 직선: [-W/2, bottomLow] -> [-W/2, topHigh]
    ];

    // 폐곡선 보장
    ptsLocal.push([...ptsLocal[0]]);

    return ptsLocal.map(([x, y]) => localMetersToLatLon(centerLat, centerLon, x, y));
}


