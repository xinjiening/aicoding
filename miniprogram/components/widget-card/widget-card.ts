Component({
  options: { multipleSlots: true },
  properties: {
    title: { type: String, value: '' },
    sub: { type: String, value: '' },
    accent: { type: Boolean, value: false },
  },
  methods: {
    onTap() {
      this.triggerEvent('tap');
    },
  },
});
