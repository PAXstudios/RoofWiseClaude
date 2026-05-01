export type AiReviewItem = {
  id: string;
  property: string;
  address: string;
  flag: string;
  confidence: number; // 0-1
  thumbnail: string;
  raisedAt: string;
};

const u = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=400&q=80&auto=format&fit=crop`;

export const aiReviewQueue: AiReviewItem[] = [
  {
    id: 'ai1',
    property: 'Park Townhomes',
    address: '901 Birch Drive',
    flag: '3 hail strikes — north slope',
    confidence: 0.62,
    thumbnail: u('1601084881623-cdf9a8ea242c'),
    raisedAt: '12 min ago',
  },
  {
    id: 'ai2',
    property: 'Reyes Property',
    address: '88 Elm Court',
    flag: 'Possible wind uplift, ridge cap',
    confidence: 0.48,
    thumbnail: u('1542621334-a254cf47733d'),
    raisedAt: '1 hr ago',
  },
  {
    id: 'ai3',
    property: 'Chen Estate',
    address: '64 Cedar Ave',
    flag: 'Granule loss vs. age — confirm',
    confidence: 0.71,
    thumbnail: u('1572120360610-d971b9d7767c'),
    raisedAt: '3 hrs ago',
  },
];
