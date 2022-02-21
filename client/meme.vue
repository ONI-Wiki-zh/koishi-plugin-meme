<template>
  <k-card>
    <el-upload
      class="upload-meme"
      drag
      action="never"
      multiple
      :accept="'.xcf,.svg'"
      :http-request="upload"
      :before-remove="(onRemove as any)"
      :file-list="fileList"
      @exceed="message.error($event)"
      list-type="picture"
    >
      <template #default>
        <div>
          <k-icon name="arrow-up">
            <upload-filled />
          </k-icon>
          <div class="el-upload__text">
            将模板文件拖到此处或
            <em>点击上传</em>
          </div>
        </div>
      </template>
      <template #file="{ file }">
        <a @click="onPreview(file)">
          <img class="el-upload-list__item-thumbnail" :src="`${route.path}/files/${file.name}.png`" />
          <a class="el-upload-list__item-name">{{ file.name }}</a>
        </a>
        <i class="el-icon el-icon--close">
          <k-icon name="times-full" @click="onRemove(file, fileList)"></k-icon>
        </i>
      </template>
    </el-upload>
    <el-dialog v-model="dialogVisible">
      <template #title>
        <b>{{ dialogTitle }}</b>
      </template>
      <template #default>
        <img style="width: 100%" :src="dialogImageUrl" />
      </template>
      <template #footer>
        <a :href="dialogTemplateUrl" target="_blank">
          <button class="k-button">下载模板</button>
        </a>
      </template>
    </el-dialog>
  </k-card>
</template>

<script lang="ts" setup>
import { message, send, store } from '@koishijs/client';
import { ElUpload, ElDialog } from 'element-plus';
import { UploadFile } from 'element-plus/es/components/upload/src/upload.type';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/upload/style/css';
import 'element-plus/es/components/dialog/style/css';
import { } from 'koishi-plugin-meme';
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router'
function test(...args: any[]) {
  console.log(args)
}
const route = useRoute()

const fileList = computed(() => (store.memes || []).map<UploadFile>(name => ({
  name,
  status: 'ready',
  size: 0,
  uid: 0,
  raw: undefined as never
})))

const dialogImageUrl = ref('')
const dialogTemplateUrl = ref('')
const dialogVisible = ref(false)
const dialogTitle = ref('')
function onPreview(file: UploadFile) {
  console.log(file)
  dialogVisible.value = true
  dialogImageUrl.value = `${route.path}/files/${file.name}.png`
  dialogTemplateUrl.value = `${route.path}/files/${file.name}`
  dialogTitle.value = file.name
}

function refresh(): void {
  send('meme/refresh');
}

async function upload(request: { file: File, onError: Function, onProgress: Function, onSuccess: Function }): Promise<void> {
  try {
    console.log(request)
    if (!request.file.name.toLowerCase().endsWith('.xcf') && !request.file.name.toLowerCase().endsWith('.svg'))
      throw new Error('请上传 xcf 文件')

    // delete first if exist
    if (store.memes?.includes(request.file.name))
      await send('meme/delete', request.file.name, false)

    const dataUri: string = await new Promise((res, rej) => {
      const r = new FileReader()
      r.readAsDataURL(request.file)
      r.onload = () => res(r.result as string);
      r.onerror = error => rej(error);
    })
    await send('meme/upload', request.file.name, dataUri)
    request.onSuccess(new Event('success'))
  } catch (e) {
    request.onError(e)
    console.error(e)
    if (e instanceof Error) message.error(`上传失败：${e.message || e.name}`)
    else message.error(`上传失败：${e}`)
  }
}

async function onRemove(file: UploadFile, _fileList: UploadFile[]): Promise<boolean> {
  try {
    await send('meme/delete', file.name)
  } catch (e) {
    if (e instanceof Error) message.error(`删除失败：${e.message || e.name}`)
    else message.error(`${file.name} 删除失败：${e}`)
    console.error(e)
    throw e
  }
  return true
}
</script>

<style lang="scss">
.upload-meme {
  .el-upload {
    width: 100%;
  }
  .el-upload-dragger {
    margin: 0 auto;

    display: flex;
    justify-content: center;
    flex-direction: column;
  }
}
</style>
