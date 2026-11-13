<script setup>
import { ref, onMounted } from 'vue'
import { useCatalogStore } from '@/stores/catalog'

const catalog = useCatalogStore()
const items = ref([])
const loading = ref(true)
const error = ref(null)

const fetchVehicles = async () => {
  try {
    items.value = await catalog.fetch('vehicles')
  } catch (err) {
    error.value = 'Failed to load vehicles'
    console.error(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchVehicles()
})
</script>

<template>
  <div class="list-view">
    <h1>Vehicles</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="loading" class="loading">Loading vehicles...</div>

    <table v-else>
      <thead>
        <tr>
          <th>ID</th>
          <th>Plate Number</th>
          <th>Model</th>
          <th>Capacity</th>
          <th>Status</th>
          <th>Created At</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ item.id }}</td>
          <td>{{ item.plate_number }}</td>
          <td>{{ item.model || '-' }}</td>
          <td>{{ item.capacity }}</td>
          <td>{{ item.status }}</td>
          <td>{{ item.created_at }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="items.length === 0 && !loading" class="empty">No vehicles found.</div>
  </div>
</template>

<style scoped>
.list-view {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

h1 {
  color: #333;
  margin-bottom: 1.5rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

th, td {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid #e0e0e0;
}

th {
  background: #f5f5f5;
  font-weight: 600;
  color: #333;
}

tr:hover {
  background: #fafafa;
}

.loading {
  text-align: center;
  padding: 3rem;
  color: #666;
}

.error {
  background: #fee2e2;
  color: #991b1b;
  padding: 1rem;
  border-radius: 4px;
  margin-bottom: 1rem;
}

.empty {
  text-align: center;
  padding: 2rem;
  color: #666;
}
</style>