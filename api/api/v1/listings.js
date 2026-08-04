import { connect } from "framer-api"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 250

const FIELD_IDS = {
  item: "mSSWDo4io",
  gallery: "xhdw9qQvN",
  mainImage: "wANKeidCb",
  price: "wGm6dxH2C",
  location: "vIQdXD9jY",
  shipping: "XyhhheKnx",
  facilityType: "a_RzUX42p",
  equipmentType: "Xg1hvsrGf",
  state: "PFOfvSu8f",
  statusRentSale: "Ht4YaKwQc",
  tag: "JQfvES5Ys",
  status2: "w249UiClY",
  status: "yaabE1cu8",
  description: "ABs6zZKe5",
  seller: "hnoubwfcp",
  sku: "nVTV8KiWQ",
  productVideo: "LJlEVgdZ8",
}

function getValue(fieldData, fieldId) {
  return fieldData?.[fieldId]?.value ?? null
}

function getImageUrl(fieldData, fieldId) {
  const image = getValue(fieldData, fieldId)
  return image?.url ?? null
}

function getGalleryUrls(fieldData) {
  const gallery = getValue(fieldData, FIELD_IDS.gallery)

  if (!Array.isArray(gallery)) {
    return []
  }

  return gallery
    .map((entry) => {
      const imageField = Object.values(entry.fieldData ?? {}).find(
        (field) => field?.type === "image"
      )

      return imageField?.value?.url ?? null
    })
    .filter(Boolean)
}

function normalizeStatus(isActive, tag) {
  const normalizedTag = String(tag ?? "").toLowerCase()

  if (normalizedTag.includes("sold")) {
    return "sold"
  }

  if (
    normalizedTag.includes("removed") ||
    normalizedTag.includes("unavailable")
  ) {
    return "removed"
  }

  if (isActive === false) {
    return "removed"
  }

  return "active"
}

function getProductVideo(fieldData) {
  const file = getValue(fieldData, FIELD_IDS.productVideo)

  if (!file) {
    return null
  }

  if (typeof file === "string") {
    return file
  }

  return file.url ?? null
}

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json")
  response.setHeader("Cache-Control", "no-store")

  if (request.method !== "GET") {
    return response.status(405).json({
      error: "Method not allowed",
    })
  }

  const suppliedApiKey = request.headers["x-api-key"]

  if (
    !process.env.M9E_API_KEY ||
    suppliedApiKey !== process.env.M9E_API_KEY
  ) {
    return response.status(401).json({
      error: "Unauthorized",
    })
  }

  const page = Math.max(
    Number.parseInt(request.query.page || "1", 10),
    1
  )

  const requestedLimit = Number.parseInt(
    request.query.limit || String(DEFAULT_LIMIT),
    10
  )

  const limit = Math.min(
    Math.max(requestedLimit, 1),
    MAX_LIMIT
  )

  let updatedSince = null

  if (request.query.updated_since) {
    updatedSince = new Date(request.query.updated_since)

    if (Number.isNaN(updatedSince.getTime())) {
      return response.status(400).json({
        error:
          "updated_since must be a valid ISO 8601 timestamp",
      })
    }
  }

  let framer

  try {
    framer = await connect(
      process.env.FRAMER_PROJECT_URL,
      process.env.FRAMER_API_KEY
    )

    const collections = await framer.getCollections()

    const marketplaceCollection = collections.find(
      (collection) =>
        collection.name ===
        process.env.FRAMER_COLLECTION_NAME
    )

    if (!marketplaceCollection) {
      return response.status(500).json({
        error: "Marketplace CMS collection not found",
        configured_collection:
          process.env.FRAMER_COLLECTION_NAME,
        available_collections: collections.map(
          (collection) => ({
            id: collection.id,
            name: collection.name,
          })
        ),
      })
    }

    const items = await marketplaceCollection.getItems()

    const listings = items
      .filter((item) => !item.draft)
      .map((item) => {
        const fields = item.fieldData ?? {}

        const sku = getValue(fields, FIELD_IDS.sku)
        const tag = getValue(fields, FIELD_IDS.tag)
        const isActive = getValue(fields, FIELD_IDS.status)

        const mainImage = getImageUrl(
          fields,
          FIELD_IDS.mainImage
        )

        const galleryImages = getGalleryUrls(fields)

        const images = Array.from(
          new Set(
            [mainImage, ...galleryImages].filter(Boolean)
          )
        )

        return {
          sku,
          slug: item.slug ?? null,
          item: getValue(fields, FIELD_IDS.item),
          price: getValue(fields, FIELD_IDS.price),
          currency: "USD",
          location: getValue(
            fields,
            FIELD_IDS.location
          ),
          shipping: getValue(
            fields,
            FIELD_IDS.shipping
          ),
          facility_type: getValue(
            fields,
            FIELD_IDS.facilityType
          ),
          equipment_type: getValue(
            fields,
            FIELD_IDS.equipmentType
          ),
          state: getValue(fields, FIELD_IDS.state),

          status: normalizeStatus(isActive, tag),
          status_active: isActive,
          status_2: getValue(
            fields,
            FIELD_IDS.status2
          ),
          status_rent_sale: getValue(
            fields,
            FIELD_IDS.statusRentSale
          ),
          tag,

          description: getValue(
            fields,
            FIELD_IDS.description
          ),
          seller: getValue(fields, FIELD_IDS.seller),

          main_image_url: mainImage,
          image_urls: images,
          product_video_url:
            getProductVideo(fields),

          created_at: item.createdAt ?? null,
          updated_at: item.updatedAt ?? null,

          source_url:
            "https://www.cannabisexpertsmarketplace.net",
        }
      })
      .filter((listing) => Boolean(listing.sku))
      .filter((listing) => {
        if (!updatedSince) {
          return true
        }

        if (!listing.updated_at) {
          return false
        }

        return (
          new Date(listing.updated_at).getTime() >
          updatedSince.getTime()
        )
      })
      .sort((a, b) =>
        String(a.sku).localeCompare(String(b.sku))
      )

    const startIndex = (page - 1) * limit

    const paginatedListings = listings.slice(
      startIndex,
      startIndex + limit
    )

    return response.status(200).json({
      data: paginatedListings,
      pagination: {
        page,
        limit,
        max_page_size: MAX_LIMIT,
        total_records: listings.length,
        total_pages: Math.ceil(
          listings.length / limit
        ),
        has_more:
          startIndex + limit < listings.length,
      },
      generated_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Marketplace API error:", error)

    return response.status(500).json({
      error: "Unable to retrieve marketplace listings",
    })
  } finally {
    if (framer) {
      await framer.disconnect()
    }
  }
}

