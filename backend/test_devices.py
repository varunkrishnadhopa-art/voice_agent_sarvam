import unittest
from desktop_agent import select_devices


def device(id, name, inputs=0, outputs=0, host='MME'):
    return dict(id=id,name=name,inputs=inputs,outputs=outputs,host=host,rate=48000)


class DeviceTests(unittest.TestCase):
    laptop=[device(1,'Microphone Realtek',inputs=1),device(3,'Speakers Realtek',outputs=2)]

    def test_connected_headset_preferred(self):
        available=self.laptop+[device(7,'Headset CMF Buds 2a',inputs=1),device(8,'Headphones CMF Buds 2a',outputs=2)]
        self.assertEqual([d['id'] for d in select_devices(available,{})],[7,8])

    def test_output_only_headset_falls_back(self):
        available=self.laptop+[device(8,'Headphones CMF Buds 2a',outputs=2)]
        self.assertEqual([d['id'] for d in select_devices(available,{})],[1,3])

    def test_reused_device_id_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'changed'):
            select_devices(self.laptop,{'inputDevice':'1','inputDeviceName':'Different mic | MME'})

    def test_independent_device_override(self):
        available=self.laptop+[device(8,'Headphones CMF Buds 2a',outputs=2)]
        self.assertEqual([d['id'] for d in select_devices(available,{'outputDevice':'8'})],[1,8])


if __name__=='__main__':
    unittest.main()
