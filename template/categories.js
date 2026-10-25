/* Dukan Builder — categories.js (locked)
   One shared dashboard design, category-aware booking fields. */
(function () {
  function inDays(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  var TYPES = {
    restaurant: {
      label: "Restaurant",
      request: "Table booking",
      cta: "Reserve a table",
      bookTitle: "Reserve a table",
      bookBlurb: "Tell us when you are coming and how many seats to set aside.",
      fields: [
        { name: "date", label: "Date", type: "date", required: true },
        { name: "time", label: "Time", type: "time", required: true },
        { name: "guests", label: "Guests", type: "number", min: 1, max: 60, required: true },
        { name: "occasion", label: "Occasion", type: "select", options: ["Casual dining", "Birthday", "Anniversary", "Business meal", "Other"] }
      ],
      sampleFields: function () {
        return { date: inDays(4), time: "19:30", guests: "4", occasion: "Birthday" };
      }
    },
    salon: {
      label: "Salon & spa",
      request: "Appointment",
      cta: "Book an appointment",
      bookTitle: "Book an appointment",
      bookBlurb: "Pick a service and a time that suits you. We will confirm by phone.",
      fields: [
        { name: "service", label: "Service", type: "select", source: "services", required: true },
        { name: "date", label: "Date", type: "date", required: true },
        { name: "time", label: "Time", type: "time", required: true },
        { name: "preference", label: "Stylist preference", type: "select", options: ["Any available stylist", "Female stylist", "Male stylist"] }
      ],
      sampleFields: function () {
        return { service: "", date: inDays(3), time: "15:00", preference: "Any available stylist" };
      }
    },
    clinic: {
      label: "Clinic",
      request: "Appointment",
      cta: "Request an appointment",
      bookTitle: "Request an appointment",
      bookBlurb: "Choose a service and preferred time. The clinic will call to confirm.",
      fields: [
        { name: "service", label: "Service", type: "select", source: "services", required: true },
        { name: "date", label: "Preferred date", type: "date", required: true },
        { name: "time", label: "Preferred time", type: "time", required: true },
        { name: "patient_type", label: "Visit type", type: "select", options: ["First visit", "Follow-up", "Routine check-up"] }
      ],
      sampleFields: function () {
        return { service: "", date: inDays(2), time: "11:00", patient_type: "First visit" };
      }
    },
    retail: {
      label: "Retail",
      request: "Order request",
      cta: "Request an order",
      bookTitle: "Request an order",
      bookBlurb: "Tell us what you need and how you would like to receive it.",
      fields: [
        { name: "product", label: "Product", type: "text", required: true, placeholder: "Product name or description" },
        { name: "quantity", label: "Quantity", type: "number", min: 1, required: true },
        { name: "fulfillment", label: "Collection or delivery", type: "select", options: ["Pickup from shop", "Delivery"] }
      ],
      sampleFields: function () {
        return { product: "Assorted gift box", quantity: "2", fulfillment: "Pickup from shop" };
      }
    },
    "real-estate": {
      label: "Real estate",
      request: "Viewing request",
      cta: "Request a viewing",
      bookTitle: "Request a viewing",
      bookBlurb: "Tell us which property interests you and when you would like to visit.",
      fields: [
        { name: "property", label: "Property", type: "text", required: true, placeholder: "Property name, code or area" },
        { name: "viewing", label: "Viewing type", type: "select", options: ["In person", "Video call"] },
        { name: "date", label: "Preferred date", type: "date", required: true },
        { name: "time", label: "Preferred time", type: "time", required: true }
      ],
      sampleFields: function () {
        return { property: "3-bed apartment, DHA Phase 5", viewing: "In person", date: inDays(5), time: "17:00" };
      }
    },
    other: {
      label: "Local business",
      request: "Enquiry request",
      cta: "Request a callback",
      bookTitle: "Request a callback",
      bookBlurb: "Leave your details and a convenient time. We will get back to you.",
      fields: [
        { name: "subject", label: "What is this about?", type: "text", required: true, placeholder: "How can we help?" },
        { name: "date", label: "Preferred date", type: "date" },
        { name: "time", label: "Preferred time", type: "time" }
      ],
      sampleFields: function () {
        return { subject: "Availability this week", date: inDays(2), time: "12:00" };
      }
    }
  };

  var STATUS = {
    new: "New",
    confirmed: "Confirmed",
    completed: "Completed",
    cancelled: "Cancelled",
    handled: "Handled",
    closed: "Closed"
  };

  window.DukanCategory = {
    names: Object.keys(TYPES),
    get: function (name) { return TYPES[name] || TYPES.other; },
    statusOptions: function (type) {
      if (type === "inquiry") return ["new", "handled", "closed"];
      return ["new", "confirmed", "completed", "cancelled"];
    },
    statusLabel: function (status) { return STATUS[status] || status; },
    sampleFields: function (name) {
      var cat = TYPES[name] || TYPES.other;
      var fields = cat.sampleFields ? cat.sampleFields() : {};
      return fields;
    }
  };
})();
