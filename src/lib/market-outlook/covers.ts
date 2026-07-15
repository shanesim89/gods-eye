// Curated cover-photo set — real, iconic, editorially chosen (Unsplash License,
// free for commercial use). One is picked at random each time a report is
// generated. Downloaded and embedded locally (public/outlook-covers/) rather
// than hotlinked, so an exported PDF never breaks if the source disappears.
export type CoverPhoto = {
  id: string;
  src: string; // public path
  location: string; // shown as the cover eyebrow
  credit: string; // photographer, shown in the small footer credit
};

export const COVER_PHOTOS: CoverPhoto[] = [
  { id: "singapore", src: "/outlook-covers/singapore-marina-bay.jpg", location: "Marina Bay, Singapore", credit: "Unsplash" },
  { id: "tokyo", src: "/outlook-covers/tokyo-shibuya.jpg", location: "Shibuya, Tokyo", credit: "Peter Thomas / Unsplash" },
  { id: "london", src: "/outlook-covers/london-towerbridge.jpg", location: "Tower Bridge, London", credit: "Frankie Lopez / Unsplash" },
  { id: "hongkong", src: "/outlook-covers/hongkong-victoria.jpg", location: "Victoria Harbour, Hong Kong", credit: "Cheung Yin / Unsplash" },
  { id: "zermatt", src: "/outlook-covers/swiss-matterhorn.jpg", location: "The Matterhorn, Zermatt", credit: "Fabrice Villard / Unsplash" },
  { id: "dubai", src: "/outlook-covers/dubai-skyline.jpg", location: "Downtown Dubai", credit: "Sirav Talwar / Unsplash" },
  { id: "shanghai", src: "/outlook-covers/shanghai-bund.jpg", location: "The Bund, Shanghai", credit: "Nicolas Jehly / Unsplash" },
];

export function randomCoverPhoto(): CoverPhoto {
  return COVER_PHOTOS[Math.floor(Math.random() * COVER_PHOTOS.length)];
}
