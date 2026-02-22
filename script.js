(() => {
  const galleryEl = document.getElementById("gallery");
  const gallerySentinel = document.getElementById("gallery-sentinel");
  const statusEl = document.getElementById("gallery-status");
  const pageHeader = document.querySelector(".page-header");
  const tagFilterWrap = document.getElementById("tag-filter-wrap");
  const tagFilterChips = document.getElementById("tag-filter-chips");
  const photoModal = document.getElementById("photo-modal");
  const photoModalImage = document.getElementById("photo-modal-image");
  const exifTitle = document.getElementById("exif-title");
  const exifShutter = document.getElementById("exif-shutter");
  const exifAperture = document.getElementById("exif-aperture");
  const exifIso = document.getElementById("exif-iso");
  const exifFocal = document.getElementById("exif-focal");
  const IMAGE_EXTENSIONS = /\.(avif|gif|jpe?g|png|webp)$/i;
  const config = window.PHOTO_PAGE_CONFIG || {};
  const imageFolder = config.imageFolder || "images";
  const INITIAL_BATCH_SIZE = Math.max(1, Math.floor(Number(config.initialBatchSize) || 18));
  const BATCH_SIZE = Math.max(1, Math.floor(Number(config.batchSize) || 12));
  let previousBodyOverflow = "";
  let previousBodyPaddingRight = "";
  let allImages = [];
  let selectedTagKeys = new Set();
  let availableTags = [];
  let loadSourceLabel = "";
  let visibleImages = [];
  let renderedImageCount = 0;
  let galleryObserver = null;
  let fallbackScrollHandler = null;
  const exifCache = new Map();
  const TAG_KEYS = [
    "Keywords",
    "XPKeywords",
    "Subject",
    "XPSubject",
    "HierarchicalSubject",
    "Category",
    "Categories",
    "LastKeywordXMP",
    "SupplementalCategories",
    "dc:subject",
    "DublinCoreSubject",
  ];
  const TAG_SPLIT_REGEX = /[;,|]/;

  const setStatus = (text) => {
    statusEl.textContent = text;
  };

  const isImageFile = (fileName) => IMAGE_EXTENSIONS.test(fileName);

  const encodedPath = (path) =>
    path
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");

  const labelFromName = (name) =>
    name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Untitled";

  const normalizeTagValue = (value) => {
    if (value === undefined || value === null) {
      return null;
    }

    const cleaned = String(value).replace(/\0/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned || /^\d+$/.test(cleaned)) {
      return null;
    }

    return cleaned;
  };

  const parseTagValue = (value) => {
    if (value === undefined || value === null) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => parseTagValue(item));
    }

    if (typeof value === "object") {
      return Object.values(value).flatMap((item) => parseTagValue(item));
    }

    const normalized = normalizeTagValue(value);
    if (!normalized) {
      return [];
    }

    if (!TAG_SPLIT_REGEX.test(normalized)) {
      return [normalized];
    }

    return normalized
      .split(TAG_SPLIT_REGEX)
      .map((item) => normalizeTagValue(item))
      .filter(Boolean);
  };

  const extractTagsFromExif = (exif) => {
    if (!exif || typeof exif !== "object") {
      return [];
    }

    const tagMap = new Map();

    const addTag = (raw) => {
      const normalized = normalizeTagValue(raw);
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (!tagMap.has(key)) {
        tagMap.set(key, {
          key,
          label: normalized,
        });
      }
    };

    TAG_KEYS.forEach((fieldName) => {
      parseTagValue(exif[fieldName]).forEach(addTag);
    });

    return [...tagMap.values()];
  };

  const getVisibleImages = () => {
    if (selectedTagKeys.size === 0) {
      return allImages;
    }

    return allImages.filter((image) => image.tagKeys.some((tagKey) => selectedTagKeys.has(tagKey)));
  };

  const updateGalleryStatus = () => {
    const visibleCount = getVisibleImages().length;
    const sourceSuffix = loadSourceLabel ? ` (${loadSourceLabel})` : "";

    if (selectedTagKeys.size === 0) {
      setStatus(`${allImages.length} photo${allImages.length === 1 ? "" : "s"} loaded${sourceSuffix}.`);
      return;
    }

    const selectedLabels = availableTags
      .filter((tag) => selectedTagKeys.has(tag.key))
      .map((tag) => tag.label);
    const selectedLabelText = selectedLabels.length > 0 ? selectedLabels.join(", ") : "selected tags";

    setStatus(
      `${visibleCount} of ${allImages.length} photo${visibleCount === 1 ? "" : "s"} for "${selectedLabelText}".`
    );
  };

  const renderTagFilters = () => {
    if (!tagFilterWrap || !tagFilterChips) {
      return;
    }

    if (availableTags.length === 0) {
      tagFilterWrap.hidden = true;
      tagFilterChips.innerHTML = "";
      return;
    }

    tagFilterWrap.hidden = false;
    tagFilterChips.innerHTML = "";

    const buildChip = (key, label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-chip";
      const isAllChip = key === "all";
      const isActive = isAllChip ? selectedTagKeys.size === 0 : selectedTagKeys.has(key);
      if (isActive) {
        button.classList.add("is-active");
      }
      button.textContent = label;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.addEventListener("click", () => {
        if (isAllChip) {
          selectedTagKeys.clear();
        } else if (selectedTagKeys.has(key)) {
          selectedTagKeys.delete(key);
        } else {
          selectedTagKeys.add(key);
        }
        renderTagFilters();
        renderGallery(getVisibleImages());
        updateGalleryStatus();
      });
      return button;
    };

    tagFilterChips.appendChild(buildChip("all", "All"));
    availableTags.forEach((tag) => {
      tagFilterChips.appendChild(buildChip(tag.key, tag.label));
    });
  };

  const rebuildAvailableTags = () => {
    const map = new Map();

    allImages.forEach((image) => {
      image.tags.forEach((tag) => {
        const existing = map.get(tag.key);
        if (existing) {
          existing.count += 1;
          return;
        }
        map.set(tag.key, {
          key: tag.key,
          label: tag.label,
          count: 1,
        });
      });
    });

    availableTags = [...map.values()].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
    );

    const availableTagKeySet = new Set(availableTags.map((tag) => tag.key));
    selectedTagKeys = new Set([...selectedTagKeys].filter((key) => availableTagKeySet.has(key)));
  };

  const getExifData = async (imageSrc) => {
    if (!window.exifr) {
      return null;
    }

    if (!exifCache.has(imageSrc)) {
      const promise = window.exifr.parse(imageSrc).catch((error) => {
        exifCache.delete(imageSrc);
        throw error;
      });
      exifCache.set(imageSrc, promise);
    }

    return exifCache.get(imageSrc);
  };

  const hydrateImageTags = async () => {
    if (!window.exifr || allImages.length === 0) {
      return;
    }

    setStatus(
      `${allImages.length} photo${allImages.length === 1 ? "" : "s"} loaded${loadSourceLabel ? ` (${loadSourceLabel})` : ""}. Reading EXIF tags...`
    );

    await Promise.all(
      allImages.map(async (image) => {
        try {
          const exif = await getExifData(image.src);
          const tags = extractTagsFromExif(exif);
          image.tags = tags;
          image.tagKeys = tags.map((tag) => tag.key);
        } catch (error) {
          image.tags = [];
          image.tagKeys = [];
        }
      })
    );

    rebuildAvailableTags();
    renderTagFilters();
    renderGallery(getVisibleImages());
    updateGalleryStatus();
  };

  const detectGitHubRepo = () => {
    const { hostname, pathname } = window.location;
    if (!hostname.endsWith(".github.io")) {
      return null;
    }

    const owner = hostname.split(".")[0];
    const segments = pathname.split("/").filter(Boolean);
    const repo = segments.length > 0 ? segments[0] : `${owner}.github.io`;
    return { owner, repo };
  };

  const normalizeManifestList = (manifestData) => {
    const items = Array.isArray(manifestData) ? manifestData : manifestData.images;
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map((item) => {
        if (typeof item === "string") {
          return {
            src: `${imageFolder}/${encodedPath(item)}`,
            label: labelFromName(item),
          };
        }

        if (item && typeof item === "object" && typeof item.src === "string") {
          const source = item.src.startsWith("http") ? item.src : `${imageFolder}/${encodedPath(item.src)}`;
          return {
            src: source,
            label: item.title || labelFromName(item.src),
          };
        }

        return null;
      })
      .filter(Boolean)
      .filter((item) => isImageFile(item.src));
  };

  const fetchImagesFromManifest = async () => {
    const response = await fetch(`${imageFolder}/manifest.json`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Manifest fetch failed (${response.status}).`);
    }

    const manifestData = await response.json();
    const images = normalizeManifestList(manifestData);
    if (images.length === 0) {
      throw new Error("Manifest loaded, but no image entries were found.");
    }

    return images.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
    );
  };

  const fetchImagesFromGitHubApi = async () => {
    const repoInfo = config.github || detectGitHubRepo();
    if (!repoInfo?.owner || !repoInfo?.repo) {
      throw new Error("Not running on GitHub Pages and no explicit repo config found.");
    }

    const folderPath = config.github?.folderPath || imageFolder;
    const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath(folderPath)}`;
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API fetch failed (${response.status}).`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("GitHub API response format was unexpected.");
    }

    const cleanFolderPath = folderPath.replace(/^\/+|\/+$/g, "");
    const images = payload
      .filter((entry) => entry.type === "file" && isImageFile(entry.name))
      .map((entry) => ({
        src: `${cleanFolderPath}/${encodedPath(entry.name)}`,
        label: labelFromName(entry.name),
      }));

    if (images.length === 0) {
      throw new Error(`No image files found in "${folderPath}".`);
    }

    return images.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
    );
  };

  const fetchImagesFromDirectoryListing = async () => {
    const directoryUrl = `${imageFolder}/`;
    const response = await fetch(directoryUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Directory listing fetch failed (${response.status}).`);
    }

    const html = await response.text();
    if (!html || typeof html !== "string") {
      throw new Error("Directory listing response was empty.");
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const links = [...doc.querySelectorAll("a[href]")].map((anchor) => anchor.getAttribute("href"));
    const seen = new Set();

    const images = links
      .map((href) => {
        if (!href) {
          return null;
        }

        if (href.startsWith("#") || href.startsWith("?")) {
          return null;
        }

        let resolved;
        try {
          resolved = new URL(href, response.url);
        } catch (error) {
          return null;
        }

        const fileName = decodeURIComponent(resolved.pathname.split("/").filter(Boolean).pop() || "");
        if (!fileName || !isImageFile(fileName)) {
          return null;
        }

        const dedupeKey = resolved.pathname.toLowerCase();
        if (seen.has(dedupeKey)) {
          return null;
        }
        seen.add(dedupeKey);

        return {
          src: resolved.href,
          label: labelFromName(fileName),
        };
      })
      .filter(Boolean);

    if (images.length === 0) {
      throw new Error(`No image links found in "${directoryUrl}".`);
    }

    return images.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
    );
  };

  const closeModal = (modal) => {
    if (!modal) {
      return;
    }
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    const hasOpenModal = document.querySelector(".modal.is-open");
    if (!hasOpenModal) {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPaddingRight;
    }
  };

  const closeAllModals = () => {
    document.querySelectorAll(".modal.is-open").forEach((modal) => closeModal(modal));
  };

  const openModal = (modal) => {
    if (!modal) {
      return;
    }
    closeAllModals();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    previousBodyOverflow = document.body.style.overflow;
    previousBodyPaddingRight = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  };

  const formatShutter = (value) => {
    if (value === undefined || value === null || value === "") {
      return "Unavailable";
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return `${value}`;
    }

    if (numeric >= 1) {
      const fixed = Number.isInteger(numeric) ? numeric.toString() : numeric.toFixed(1);
      return `${fixed}s`;
    }

    const reciprocal = Math.round(1 / numeric);
    if (reciprocal > 1) {
      return `1/${reciprocal}s`;
    }

    return `${numeric.toFixed(3)}s`;
  };

  const formatAperture = (value) => {
    if (value === undefined || value === null || value === "") {
      return "Unavailable";
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return `${value}`;
    }
    const fixed = Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(1);
    return `f/${fixed}`;
  };

  const formatIso = (value) => {
    if (value === undefined || value === null || value === "") {
      return "Unavailable";
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return `${value}`;
    }
    return `${Math.round(numeric)}`;
  };

  const formatFocalLength = (value) => {
    if (value === undefined || value === null || value === "") {
      return "Unavailable";
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return `${value}`;
    }
    const fixed = Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(1);
    return `${fixed}mm`;
  };

  const flattenExifText = (value) => {
    if (value === undefined || value === null) {
      return "";
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const candidate = flattenExifText(item);
        if (candidate) {
          return candidate;
        }
      }
      return "";
    }

    if (typeof value === "object") {
      for (const item of Object.values(value)) {
        const candidate = flattenExifText(item);
        if (candidate) {
          return candidate;
        }
      }
      return "";
    }

    return String(value).replace(/\0/g, " ").replace(/\s+/g, " ").trim();
  };

  const formatTitle = (exif, fallbackTitle) => {
    const titleFields = [
      "Title",
      "XPTitle",
      "ObjectName",
      "ImageDescription",
      "Description",
      "Caption",
      "Headline",
      "DocumentName",
    ];

    for (const field of titleFields) {
      const value = flattenExifText(exif?.[field]);
      if (value) {
        return value;
      }
    }

    return fallbackTitle || "Unavailable";
  };

  const resetExifFields = (loading = false) => {
    const label = loading ? "Loading..." : "Unavailable";
    exifTitle.textContent = label;
    exifShutter.textContent = label;
    exifAperture.textContent = label;
    exifIso.textContent = label;
    exifFocal.textContent = label;
  };

  const loadExif = async (imageSrc, fallbackTitle) => {
    resetExifFields(true);

    if (!window.exifr) {
      exifTitle.textContent = fallbackTitle || "EXIF library missing";
      exifShutter.textContent = "EXIF library missing";
      exifAperture.textContent = "EXIF library missing";
      exifIso.textContent = "EXIF library missing";
      exifFocal.textContent = "EXIF library missing";
      console.warn("EXIF parser is unavailable. Check if exifr script loaded.");
      return;
    }

    try {
      const exif = await getExifData(imageSrc);

      exifTitle.textContent = formatTitle(exif, fallbackTitle);
      exifShutter.textContent = formatShutter(exif?.ExposureTime);
      exifAperture.textContent = formatAperture(exif?.FNumber);
      exifIso.textContent = formatIso(exif?.ISO ?? exif?.PhotographicSensitivity ?? exif?.ISOSpeedRatings);
      exifFocal.textContent = formatFocalLength(
        exif?.FocalLength ?? exif?.FocalLengthIn35mmFormat ?? exif?.FocalLengthIn35mmFilm
      );
    } catch (error) {
      resetExifFields(false);
      console.warn("Failed to parse EXIF for image:", imageSrc, error);
    }
  };

  const createPhotoTile = (image) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "photo-tile";
    button.setAttribute("aria-label", `Open ${image.label}`);

    const img = document.createElement("img");
    img.src = image.src;
    img.alt = image.label;
    img.loading = "lazy";
    img.decoding = "async";

    button.appendChild(img);
    button.addEventListener("click", () => {
      openPhotoModal(image);
    });

    return button;
  };

  const updateGallerySentinel = () => {
    if (!gallerySentinel) {
      return;
    }

    const hasMoreImages = renderedImageCount < visibleImages.length;
    gallerySentinel.hidden = !hasMoreImages;

    if (!galleryObserver) {
      return;
    }

    if (hasMoreImages) {
      galleryObserver.observe(gallerySentinel);
    } else {
      galleryObserver.unobserve(gallerySentinel);
    }
  };

  const appendGalleryBatch = (batchSize = BATCH_SIZE) => {
    if (renderedImageCount >= visibleImages.length) {
      updateGallerySentinel();
      return;
    }

    const endIndex = Math.min(renderedImageCount + batchSize, visibleImages.length);
    const fragment = document.createDocumentFragment();
    for (let index = renderedImageCount; index < endIndex; index += 1) {
      fragment.appendChild(createPhotoTile(visibleImages[index]));
    }

    galleryEl.appendChild(fragment);
    renderedImageCount = endIndex;
    updateGallerySentinel();
  };

  const openPhotoModal = async (image) => {
    photoModalImage.src = image.src;
    photoModalImage.alt = image.label;
    openModal(photoModal);
    await loadExif(image.src, image.label);
  };

  const renderGallery = (images) => {
    visibleImages = images;
    renderedImageCount = 0;
    galleryEl.innerHTML = "";
    appendGalleryBatch(INITIAL_BATCH_SIZE);
  };

  const setLoadFailure = () => {
    setStatus(
      "Unable to load photos automatically. Use GitHub Pages, a server with /images/ listing, or images/manifest.json."
    );
  };

  const setupModalEvents = () => {
    document.querySelectorAll("[data-open-modal]").forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const modalId = trigger.getAttribute("data-open-modal");
        const target = document.getElementById(modalId);
        openModal(target);
      });
    });

    document.querySelectorAll("[data-close-modal]").forEach((trigger) => {
      trigger.addEventListener("click", () => {
        closeModal(trigger.closest(".modal"));
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeAllModals();
      }
    });
  };

  const setupHeaderScrollBehavior = () => {
    if (!pageHeader) {
      return;
    }

    let lastScrollY = window.scrollY;
    let ticking = false;

    const updateHeaderVisibility = () => {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;

      if (currentScrollY <= 8) {
        pageHeader.classList.remove("is-hidden");
        lastScrollY = currentScrollY;
        return;
      }

      if (delta > 6) {
        pageHeader.classList.add("is-hidden");
      } else if (delta < -6) {
        pageHeader.classList.remove("is-hidden");
      }

      lastScrollY = currentScrollY;
    };

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) {
          return;
        }
        ticking = true;
        window.requestAnimationFrame(() => {
          updateHeaderVisibility();
          ticking = false;
        });
      },
      { passive: true }
    );
  };

  const setupGalleryInfiniteScroll = () => {
    if (!gallerySentinel) {
      return;
    }

    if ("IntersectionObserver" in window) {
      galleryObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            appendGalleryBatch(BATCH_SIZE);
          }
        },
        {
          root: null,
          rootMargin: "420px 0px",
          threshold: 0,
        }
      );
      updateGallerySentinel();
      return;
    }

    let ticking = false;
    fallbackScrollHandler = () => {
      if (ticking || !gallerySentinel || gallerySentinel.hidden) {
        return;
      }
      ticking = true;
      window.requestAnimationFrame(() => {
        const sentinelTop = gallerySentinel.getBoundingClientRect().top;
        if (sentinelTop <= window.innerHeight + 420) {
          appendGalleryBatch(BATCH_SIZE);
        }
        ticking = false;
      });
    };

    window.addEventListener("scroll", fallbackScrollHandler, { passive: true });
  };

  const loadAndRenderGallery = async () => {
    try {
      const images = await fetchImagesFromGitHubApi();
      allImages = images.map((image) => ({
        ...image,
        tags: [],
        tagKeys: [],
      }));
      selectedTagKeys.clear();
      loadSourceLabel = "";
      availableTags = [];
      renderTagFilters();
      renderGallery(getVisibleImages());
      updateGalleryStatus();
      hydrateImageTags();
      return;
    } catch (githubError) {
      try {
        const images = await fetchImagesFromDirectoryListing();
        allImages = images.map((image) => ({
          ...image,
          tags: [],
          tagKeys: [],
        }));
        selectedTagKeys.clear();
        loadSourceLabel = "directory fallback";
        availableTags = [];
        renderTagFilters();
        renderGallery(getVisibleImages());
        updateGalleryStatus();
        hydrateImageTags();
        return;
      } catch (listingError) {
        try {
          const images = await fetchImagesFromManifest();
          allImages = images.map((image) => ({
            ...image,
            tags: [],
            tagKeys: [],
          }));
          selectedTagKeys.clear();
          loadSourceLabel = "manifest fallback";
          availableTags = [];
          renderTagFilters();
          renderGallery(getVisibleImages());
          updateGalleryStatus();
          hydrateImageTags();
          return;
        } catch (manifestError) {
          setLoadFailure();
        }
      }
    }
  };

  setupGalleryInfiniteScroll();
  setupHeaderScrollBehavior();
  setupModalEvents();
  loadAndRenderGallery();
})();
